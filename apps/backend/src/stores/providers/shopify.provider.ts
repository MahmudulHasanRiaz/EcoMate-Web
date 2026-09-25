/**
 * Shopify adapter — P1 capability declaration (central-commerce §7.1).
 *
 * Phase-1 stock is `unsupported` (BR-08): zero writes, read-only drift
 * reporting. Variants with orders cannot be deleted → archive + issue.
 * `handle` is the slug; dimensions are not native → skipped with a reason.
 * Live adapter lands in P9 (entry prerequisite: dev store + custom-app
 * token); no core-service change may be needed to add it.
 */
import { Injectable } from '@nestjs/common';
import { BaseCommerceProvider } from './base-provider';
import type {
  ProviderCapabilities,
  StoreWithSecrets,
  TestConnectionResult,
  WebhookVerification,
} from './provider.contract';
import { getHeader, safeEqualString, signShopifyDelivery } from './webhook-crypto';

@Injectable()
export class ShopifyProvider extends BaseCommerceProvider {
  readonly slug = 'shopify' as const;

  readonly declaredCapabilities: ProviderCapabilities = {
    products: true,
    variations: true,
    variantDelete: false, // cannot delete a variant with orders → archive + issue
    categories: true, // collections per path + product_type (adapter-internal)
    media: true,
    mediaReuse: true, // via stored media id
    delete: true,
    seo: true, // seo.title / seo.description
    costPrice: true, // inventory_item.cost (never customer-facing — BR-23)
    weight: true,
    dimensions: false, // not native → skipped with reason
    slug: true, // handle
    orders: true,
    webhooks: true,
    orderStatusUpdate: true,
    orderStatusUpdateTargets: ['CANCELLED', 'FULFILLED'],
    stockStatusFidelity: 'unsupported', // BR-08: no writes, monitor-only
    contactCheckExposure: true, // via bridge / app proxy
    categoryModel: 'collection',
    seoModel: 'native',
    mediaModel: 'binary-upload',
    combos: false, // BR-22
    externalEditsDetectable: 'inferred',
  };

  /**
   * P2: §8.11 Table A subset. Excludes `dimensions` (not native → skipped
   * with reason). Includes `costPrice` (`inventory_item.cost`, never
   * customer-facing — BR-23).
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
    'costPrice',
    'weight',
    'seoTitle',
    'seoDescription',
    'slug',
    'publicationState',
    'customFields',
  ];

  /** P2 probe: `GET https://{shop}/admin/api/2024-01/shop.json` (token). */
  async testConnection(store: StoreWithSecrets): Promise<TestConnectionResult> {
    const secrets = store.secrets ?? {};
    const settings = store.settings ?? {};
    const shop = String(secrets.shop ?? settings.shop ?? '').replace(/\/+$/, '');
    if (!shop || !secrets.accessToken) {
      return {
        reachable: false,
        authenticated: false,
        permissionsOk: false,
        capabilities: this.declaredCapabilities,
      };
    }
    const probed = await this.tryProbe(
      `https://${shop}/admin/api/2024-01/shop.json`,
      { headers: { 'X-Shopify-Access-Token': String(secrets.accessToken) } },
    );
    // Network failure → unreachable as data, never a throw (see WooCommerce).
    if (!probed) {
      return {
        reachable: false,
        authenticated: false,
        permissionsOk: false,
        capabilities: this.declaredCapabilities,
      };
    }
    const { status, body } = probed;
    const shopNode = (body as any)?.shop as Record<string, unknown> | undefined;
    const providerStoreId =
      shopNode?.myshopify_domain !== undefined
        ? String(shopNode.myshopify_domain)
        : undefined;
    return this.connectionFromProbe(
      status,
      body,
      providerStoreId,
      this.declaredCapabilities,
    );
  }

  /**
   * P2: `X-Shopify-Hmac-Sha256` (base64 HMAC-SHA256) + delivery id
   * (`X-Shopify-Webhook-Id`) + topic (`X-Shopify-Topic`).
   */
  verifyWebhook(
    store: StoreWithSecrets,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookVerification {
    const secret = String(store.secrets?.webhookSecret ?? '');
    if (!secret) return { valid: false, reason: 'no-secret-configured' };
    const signature = getHeader(headers, 'X-Shopify-Hmac-Sha256');
    if (!signature) return { valid: false, reason: 'missing-signature' };
    if (!safeEqualString(signature, signShopifyDelivery(secret, rawBody))) {
      return { valid: false, reason: 'bad-signature' };
    }
    const deliveryId = getHeader(headers, 'X-Shopify-Webhook-Id');
    if (!deliveryId) return { valid: false, reason: 'missing-delivery-id' };
    return {
      valid: true,
      deliveryId,
      topic: getHeader(headers, 'X-Shopify-Topic'),
    };
  }
}
