/**
 * WooCommerce adapter — P1 capability declaration (central-commerce §7.1).
 *
 * First implementation priority (P4): faithful stock (`stock_status =
 * instock/outofstock`), `product_cat` taxonomy with real hierarchy,
 * `?force=true` delete, HMAC webhooks. Companion-plugin capabilities
 * (field-change provenance → `externalEditsDetectable: 'plugin'`, SEO via
 * `meta_data`, media source-hash reuse, contact-check) degrade to the
 * REST-only values declared here until the plugin version gate passes.
 */
import { Injectable } from '@nestjs/common';
import { BaseCommerceProvider } from './base-provider';
import type {
  ProviderCapabilities,
  StoreWithSecrets,
  TestConnectionResult,
  WebhookVerification,
} from './provider.contract';
import { getHeader, safeEqualString, signWooDelivery } from './webhook-crypto';

@Injectable()
export class WooCommerceProvider extends BaseCommerceProvider {
  readonly slug = 'woocommerce' as const;

  readonly declaredCapabilities: ProviderCapabilities = {
    products: true,
    variations: true,
    variantDelete: true,
    categories: true,
    media: true,
    mediaReuse: false, // true only with the companion plugin (source-hash reuse)
    delete: true,
    seo: false, // plugin-only via meta_data → Yoast/RankMath
    costPrice: false, // no native field → never pushed (BR-23)
    weight: true,
    dimensions: true,
    slug: true,
    orders: true,
    webhooks: true,
    orderStatusUpdate: true,
    orderStatusUpdateTargets: ['cancelled', 'completed'],
    stockStatusFidelity: 'faithful',
    contactCheckExposure: true,
    categoryModel: 'taxonomy',
    seoModel: 'plugin-meta',
    mediaModel: 'url-fetch',
    combos: false, // BR-22: skipped with an explicit reason, never fabricated
    externalEditsDetectable: 'inferred', // 'plugin' once the companion plugin reports provenance
  };

  /**
   * P2: §8.11 Table A subset. Excludes `costPrice` (BR-23: no native field,
   * never pushed) and `seoTitle`/`seoDescription` (plugin-only, `seo:false`).
   * Product Code / Barcode are ≡ SKU (§2) and ride on the `sku` target.
   */
  readonly syncedFields = [
    'name',
    'shortDescription',
    'fullDescription',
    'sku',
    'productCode',
    'barcode',
    'primaryImage',
    'galleryImages',
    'category',
    'brand',
    'tags',
    'productType',
    'variants',
    'variantAttributes',
    'price',
    'salePrice',
    'weight',
    'dimensions',
    'slug',
    'publicationState',
    'customFields',
  ];

  /** P2 probe: `GET {baseUrl}/wp-json/wc/v3/system_status` (Basic auth). */
  async testConnection(store: StoreWithSecrets): Promise<TestConnectionResult> {
    const secrets = store.secrets ?? {};
    const settings = store.settings ?? {};
    const baseUrl = String(
      secrets.baseUrl ?? settings.baseUrl ?? '',
    ).replace(/\/+$/, '');
    if (!baseUrl || !secrets.consumerKey || !secrets.consumerSecret) {
      return {
        reachable: false,
        authenticated: false,
        permissionsOk: false,
        capabilities: this.declaredCapabilities,
      };
    }
    const basic = Buffer.from(
      `${String(secrets.consumerKey)}:${String(secrets.consumerSecret)}`,
    ).toString('base64');
    const probed = await this.tryProbe(
      `${baseUrl}/wp-json/wc/v3/system_status`,
      { headers: { Authorization: `Basic ${basic}` } },
    );
    // Network failure → unreachable as data, never a throw (wizard renders
    // results, not exceptions; sync jobs classify via classifyProviderError).
    if (!probed) {
      return {
        reachable: false,
        authenticated: false,
        permissionsOk: false,
        capabilities: this.declaredCapabilities,
      };
    }
    const { status, body } = probed;
    const providerStoreId =
      (body as any)?.settings?.site_url !== undefined
        ? String((body as any).settings.site_url)
        : undefined;
    return this.connectionFromProbe(
      status,
      body,
      providerStoreId,
      this.declaredCapabilities,
      await this.mediaPreflight(settings),
    );
  }

  /** P2: `X-WC-Webhook-Signature` = base64 HMAC-SHA256 over the raw body. */
  verifyWebhook(
    store: StoreWithSecrets,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookVerification {
    const secret = String(store.secrets?.webhookSecret ?? '');
    if (!secret) return { valid: false, reason: 'no-secret-configured' };
    const signature = getHeader(headers, 'X-WC-Webhook-Signature');
    if (!signature) return { valid: false, reason: 'missing-signature' };
    if (!safeEqualString(signature, signWooDelivery(secret, rawBody))) {
      return { valid: false, reason: 'bad-signature' };
    }
    return {
      valid: true,
      deliveryId: getHeader(headers, 'X-WC-Webhook-Delivery-ID'),
      topic: getHeader(headers, 'X-WC-Webhook-Topic'),
    };
  }

  /** Media preflight (plan §12): HEAD the configured probe URL when set. */
  private async mediaPreflight(
    settings: Record<string, unknown>,
  ): Promise<boolean | undefined> {
    const probeUrl = settings.mediaProbeUrl;
    if (typeof probeUrl !== 'string' || probeUrl.length === 0) return undefined;
    try {
      const res = await this.fetchFn(probeUrl, { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  }
}
