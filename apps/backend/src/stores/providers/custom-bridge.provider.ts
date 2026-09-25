/**
 * Custom bridge adapter — P1 capability declaration (central-commerce §7.1).
 *
 * Capabilities are manifest-discovered (Bridge v1, P10); the values below
 * are the safe defaults until a manifest is read: status-only stock is the
 * tested default path. A manifest may only narrow writes, never widen them
 * past these defaults without an explicit audited capability grant (P10).
 *
 * P7 note (§8.6): pushOrderStatus/readOrderStatus stay on the base stub
 * (loud `notImplemented`, never a silent no-op) until P10 — the push worker
 * records the stub throw as an explicit failure/skip, never silence.
 */
import { Injectable } from '@nestjs/common';
import { BaseCommerceProvider } from './base-provider';
import type {
  ProviderCapabilities,
  StoreWithSecrets,
  TestConnectionResult,
  WebhookVerification,
} from './provider.contract';
import {
  getHeader,
  isTimestampFresh,
  safeEqualString,
  signCustomDelivery,
} from './webhook-crypto';

@Injectable()
export class CustomBridgeProvider extends BaseCommerceProvider {
  readonly slug = 'custom' as const;

  readonly declaredCapabilities: ProviderCapabilities = {
    products: true,
    variations: true,
    variantDelete: true,
    categories: true,
    media: true,
    mediaReuse: true,
    delete: true,
    seo: true,
    costPrice: false, // manifest may enable; never customer-facing (BR-23)
    weight: true,
    dimensions: true,
    slug: true,
    orders: true,
    webhooks: true,
    orderStatusUpdate: true,
    orderStatusUpdateTargets: ['cancelled', 'completed'],
    stockStatusFidelity: 'faithful', // status-only recommended; manifest narrows
    contactCheckExposure: true,
    categoryModel: 'custom',
    seoModel: 'native',
    mediaModel: 'url-fetch',
    combos: false, // BR-22; manifest-declared only
    externalEditsDetectable: 'inferred',
  };

  /**
   * P2: §8.11 Table A subset (safe defaults until a manifest is read in
   * P10). Excludes `costPrice` (manifest may enable; never customer-facing
   * — BR-23).
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
    'seoTitle',
    'seoDescription',
    'slug',
    'publicationState',
    'customFields',
  ];

  /** P2 probe: `GET {baseUrl}/bridge/v1/manifest` (bearer bridge key). */
  async testConnection(store: StoreWithSecrets): Promise<TestConnectionResult> {
    const secrets = store.secrets ?? {};
    const settings = store.settings ?? {};
    const baseUrl = String(
      secrets.baseUrl ?? settings.baseUrl ?? '',
    ).replace(/\/+$/, '');
    if (!baseUrl || !secrets.bridgeKey) {
      return {
        reachable: false,
        authenticated: false,
        permissionsOk: false,
        capabilities: this.declaredCapabilities,
      };
    }
    const probed = await this.tryProbe(
      `${baseUrl}/bridge/v1/manifest`,
      { headers: { Authorization: `Bearer ${String(secrets.bridgeKey)}` } },
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
    const providerStoreId =
      (body as any)?.storeId !== undefined
        ? String((body as any).storeId)
        : undefined;
    return this.connectionFromProbe(
      status,
      body,
      providerStoreId,
      this.declaredCapabilities,
    );
  }

  /**
   * P2: `X-EcoMate-Signature` (hex HMAC over
   * `deliveryId.timestamp.rawBody`) + `X-EcoMate-Delivery-Id` +
   * `X-EcoMate-Timestamp` inside the 5-minute replay window (§8.7).
   */
  verifyWebhook(
    store: StoreWithSecrets,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookVerification {
    const secret = String(store.secrets?.webhookSecret ?? '');
    if (!secret) return { valid: false, reason: 'no-secret-configured' };
    const signature = getHeader(headers, 'X-EcoMate-Signature');
    const deliveryId = getHeader(headers, 'X-EcoMate-Delivery-Id');
    const timestamp = getHeader(headers, 'X-EcoMate-Timestamp');
    if (!signature) return { valid: false, reason: 'missing-signature' };
    if (!deliveryId) return { valid: false, reason: 'missing-delivery-id' };
    if (!isTimestampFresh(timestamp)) {
      return { valid: false, reason: 'stale-timestamp' };
    }
    const expected = signCustomDelivery(
      secret,
      deliveryId,
      timestamp as string,
      rawBody,
    );
    if (!safeEqualString(signature, expected)) {
      return { valid: false, reason: 'bad-signature' };
    }
    return { valid: true, deliveryId, topic: getHeader(headers, 'X-EcoMate-Topic') };
  }
}
