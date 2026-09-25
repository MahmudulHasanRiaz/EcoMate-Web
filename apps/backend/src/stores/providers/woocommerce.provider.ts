/**
 * WooCommerce live adapter — central-commerce P4 (first implementation
 * priority). REST over Basic auth (consumerKey:consumerSecret):
 * products/variations/categories/status/delete?force=true/orders fetch +
 * HMAC webhooks (verifyWebhook was P2, unchanged).
 *
 * Field mapping (§8.11 Table A, WooCommerce target column):
 * name→name, shortDescription→short_description, fullDescription→
 * description, sku→sku, price→regular_price, salePrice→sale_price,
 * slug→slug, weight→weight, dimensions→dimensions{}, category→
 * categories[] (taxonomy term ids), brand→meta_data (no native field w/o
 * plugin), tags→tags[] ({name}), primaryImage/galleryImages→images[{src}],
 * publicationState→status (publish/draft), customFields→meta_data
 * (allowlisted keys only, never secrets). Cost/seo never pushed (BR-23,
 * seo:false plugin-only). Stock is status-only (BR-06): stock_status =
 * instock/outofstock, verified by read-back in the engine.
 */
import { Injectable } from '@nestjs/common';
import { ProviderError, ProviderErrorCategory } from '../../marketing/ad-provider.adapter';
import { BaseCommerceProvider } from './base-provider';
import type {
  CategoryInput,
  CategoryPath,
  FieldKey,
  FieldSnapshot,
  NormalizedMedia,
  NormalizedOrder,
  NormalizedProduct,
  NormalizedVariant,
  ProviderCapabilities,
  PushResult,
  RemoteRef,
  StockState,
  StoreWithSecrets,
  TestConnectionResult,
  WebhookRegistrationResult,
  WebhookVerification,
} from './provider.contract';
import { getHeader, safeEqualString, signWooDelivery } from './webhook-crypto';
import { snapshotField } from './field-snapshot';
import { classifyHttpStatus } from './retry-classifier';

interface WooContext {
  baseUrl: string;
  authHeader: string;
}

function ctxOf(store: StoreWithSecrets): WooContext {
  const secrets = store.secrets ?? {};
  const settings = store.settings ?? {};
  const baseUrl = String(secrets.baseUrl ?? settings.baseUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl || !secrets.consumerKey || !secrets.consumerSecret) {
    throw new ProviderError(
      '[woocommerce] missing connection settings (baseUrl/consumerKey/consumerSecret)',
      ProviderErrorCategory.INVALID_REQUEST,
      'woocommerce',
    );
  }
  const basic = Buffer.from(`${String(secrets.consumerKey)}:${String(secrets.consumerSecret)}`).toString('base64');
  return { baseUrl, authHeader: `Basic ${basic}` };
}

function toProviderError(slug: string, status: number, body: unknown, path: string): ProviderError {
  const decision = classifyHttpStatus(status);
  return new ProviderError(
    `[${slug}] ${path} → http-${status}: ${JSON.stringify(body ?? null).slice(0, 300)}`,
    decision.category,
    slug,
  );
}

export function wooFieldToPayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.shortDescription !== undefined) out.short_description = input.shortDescription;
  if (input.fullDescription !== undefined) out.description = input.fullDescription;
  if (input.sku !== undefined) out.sku = input.sku;
  if (input.price !== undefined) out.regular_price = input.price === null ? '' : String(input.price);
  if (input.salePrice !== undefined) out.sale_price = input.salePrice === null ? '' : String(input.salePrice);
  if (input.slug !== undefined) out.slug = input.slug;
  if (input.weight !== undefined) out.weight = input.weight;
  if (input.dimensions !== undefined && input.dimensions !== null && typeof input.dimensions === 'object') {
    const d = input.dimensions as Record<string, unknown>;
    out.dimensions = { length: d.length ?? '', width: d.width ?? '', height: d.height ?? '' };
  }
  if (input.category !== undefined && input.category !== null) {
    const ids = Array.isArray(input.category) ? input.category : [input.category];
    out.categories = ids.map((id) => ({ id: String(id) }));
  }
  if (input.brand !== undefined && input.brand !== null) {
    out.meta_data = [...((out.meta_data as unknown[]) ?? []), { key: '_ecomate_brand', value: String(input.brand) }];
  }
  if (input.tags !== undefined) {
    const tags = Array.isArray(input.tags) ? input.tags : [];
    out.tags = tags.map((t) => ({ name: typeof t === 'string' ? t : String((t as any)?.name ?? t) }));
  }
  const images: { src: string }[] = [];
  if (input.primaryImage) images.push({ src: String(input.primaryImage) });
  if (Array.isArray(input.galleryImages)) {
    for (const src of input.galleryImages as unknown[]) {
      if (src) images.push({ src: String(src) });
    }
  }
  if (images.length > 0) out.images = images;
  if (input.publicationState !== undefined) {
    out.status = input.publicationState === 'published' ? 'publish' : 'draft';
  }
  if (input.customFields !== undefined && input.customFields !== null && typeof input.customFields === 'object') {
    const meta = Object.entries(input.customFields as Record<string, unknown>).map(([key, value]) => ({ key, value }));
    out.meta_data = [...((out.meta_data as unknown[]) ?? []), ...meta];
  }
  // NEVER pushed: costPrice (BR-23, no native field), seoTitle/seoDescription
  // (plugin-only, seo:false), productType (structural — set at create only).
  if (input.productType !== undefined && out.type === undefined) {
    const t = String(input.productType);
    if (t === 'simple' || t === 'variable') out.type = t;
  }
  return out;
}

export function wooProductToSnapshots(body: Record<string, unknown>, fields: FieldKey[]): Record<FieldKey, FieldSnapshot> {
  const images = (Array.isArray(body.images) ? body.images : []) as { src?: string }[];
  const meta = (Array.isArray(body.meta_data) ? body.meta_data : []) as { key?: string; value?: unknown }[];
  const metaOf = (key: string): unknown => meta.find((m) => m.key === key)?.value ?? null;
  const derived: Record<string, unknown> = {
    name: body.name ?? null,
    shortDescription: body.short_description ?? null,
    fullDescription: body.description ?? null,
    sku: body.sku ?? null,
    productCode: body.sku ?? null,
    barcode: body.sku ?? null,
    primaryImage: images[0]?.src ?? null,
    galleryImages: images.slice(1).map((i) => i.src).filter(Boolean),
    category: (Array.isArray(body.categories) ? body.categories : []).map((c: any) => String(c?.id ?? c)),
    brand: metaOf('_ecomate_brand'),
    tags: (Array.isArray(body.tags) ? body.tags : []).map((t: any) => t?.name ?? t),
    productType: body.type ?? null,
    price: body.regular_price ?? null,
    salePrice: body.sale_price ?? null,
    weight: body.weight ?? null,
    dimensions: body.dimensions ?? null,
    seoTitle: null,
    seoDescription: null,
    slug: body.slug ?? null,
    publicationState: body.status === 'publish' ? 'published' : 'draft',
    customFields: Object.fromEntries(meta.filter((m) => m.key && !String(m.key).startsWith('_ecomate')).map((m) => [String(m.key), m.value])),
  };
  const out: Record<FieldKey, FieldSnapshot> = {};
  for (const f of fields) out[f] = snapshotField(derived[f]);
  return out;
}

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

  private async woo<T>(store: StoreWithSecrets, method: string, path: string, body?: unknown): Promise<T> {
    const ctx = ctxOf(store);
    const res = await this.fetchFn(`${ctx.baseUrl}/wp-json/wc/v3${path}`, {
      method,
      headers: { Authorization: ctx.authHeader, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) throw toProviderError(this.slug, res.status, parsed, `${method} ${path}`);
    return parsed as T;
  }

  /** P2 probe: `GET {baseUrl}/wp-json/wc/v3/system_status` (Basic auth). */
  override async testConnection(store: StoreWithSecrets): Promise<TestConnectionResult> {
    const secrets = store.secrets ?? {};
    const settings = store.settings ?? {};
    const baseUrl = String(secrets.baseUrl ?? settings.baseUrl ?? '').replace(/\/+$/, '');
    if (!baseUrl || !secrets.consumerKey || !secrets.consumerSecret) {
      return { reachable: false, authenticated: false, permissionsOk: false, capabilities: this.declaredCapabilities };
    }
    const basic = Buffer.from(`${String(secrets.consumerKey)}:${String(secrets.consumerSecret)}`).toString('base64');
    const probed = await this.tryProbe(`${baseUrl}/wp-json/wc/v3/system_status`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!probed) {
      return { reachable: false, authenticated: false, permissionsOk: false, capabilities: this.declaredCapabilities };
    }
    const { status, body } = probed;
    const providerStoreId =
      (body as any)?.settings?.site_url !== undefined ? String((body as any).settings.site_url) : undefined;
    return this.connectionFromProbe(status, body, providerStoreId, this.declaredCapabilities, await this.mediaPreflight(settings));
  }

  /** P2: `X-WC-Webhook-Signature` = base64 HMAC-SHA256 over the raw body. */
  override verifyWebhook(
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
  private async mediaPreflight(settings: Record<string, unknown>): Promise<boolean | undefined> {
    const probeUrl = settings.mediaProbeUrl;
    if (typeof probeUrl !== 'string' || probeUrl.length === 0) return undefined;
    try {
      const res = await this.fetchFn(probeUrl, { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** First-contact lookup by SKU (BR-05 adopt_existing probe). */
  async findBySku(store: StoreWithSecrets, sku: string): Promise<RemoteRef | null> {
    const list = await this.woo<any[]>(store, 'GET', `/products?sku=${encodeURIComponent(sku)}&per_page=1`);
    const first = list[0] as { id?: number | string } | undefined;
    return first?.id !== undefined ? { providerId: String(first.id) } : null;
  }

  override async ensureCategories(store: StoreWithSecrets, paths: CategoryPath[]): Promise<Map<string, RemoteRef>> {
    const out = new Map<string, RemoteRef>();
    for (const path of paths) {
      let parent: number | null = null;
      for (let i = 0; i < path.length; i++) {
        const name = path[i] as string;
        const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
        // Slug-within-parent lookup (duplicate prevention, §8.9).
        const found = await this.woo<any[]>(
          store, 'GET',
          `/products/categories?slug=${encodeURIComponent(slug)}&per_page=100${parent !== null ? `&parent=${parent}` : ''}`,
        );
        let term = (found as any[]).find((c) => c.slug === slug && (parent === null || c.parent === parent));
        if (!term) {
          term = await this.woo<any>(store, 'POST', '/products/categories', { name, slug, parent: parent ?? 0 });
        }
        parent = Number(term.id);
        if (i === path.length - 1) out.set(path.join(' / '), { providerId: String(term.id) });
      }
    }
    return out;
  }

  override async renameCategory(store: StoreWithSecrets, ref: RemoteRef, next: CategoryInput): Promise<PushResult> {
    const term = await this.woo<any>(store, 'PUT', `/products/categories/${encodeURIComponent(ref.providerId)}`, { name: next.name, slug: next.slug });
    return { ok: true, ref: { providerId: String(term.id) } };
  }

  override async moveCategory(store: StoreWithSecrets, ref: RemoteRef, parent: RemoteRef | null): Promise<PushResult> {
    const term = await this.woo<any>(store, 'PUT', `/products/categories/${encodeURIComponent(ref.providerId)}`, { parent: parent ? Number(parent.providerId) : 0 });
    return { ok: true, ref: { providerId: String(term.id) } };
  }

  override async readProductFields(store: StoreWithSecrets, ref: RemoteRef, fields: FieldKey[]): Promise<Record<FieldKey, FieldSnapshot>> {
    const body = await this.woo<Record<string, unknown>>(store, 'GET', `/products/${encodeURIComponent(ref.providerId)}`);
    return wooProductToSnapshots(body, fields);
  }

  override async upsertProduct(store: StoreWithSecrets, input: NormalizedProduct, fields: FieldKey[]): Promise<RemoteRef> {
    const rec = input as Record<string, unknown>;
    const payload = wooFieldToPayload(rec);
    const externalId = typeof rec.__externalId === 'string' ? rec.__externalId : undefined;
    if (externalId) {
      const updated = await this.woo<{ id?: number | string }>(store, 'PUT', `/products/${encodeURIComponent(externalId)}`, payload);
      return { providerId: String((updated as any).id ?? externalId) };
    }
    // Idempotent create: SKU match first (same sku → same ref).
    const sku = typeof rec.sku === 'string' && rec.sku.length > 0 ? rec.sku : undefined;
    if (sku) {
      const existing = await this.findBySku(store, sku);
      if (existing) {
        const updated = await this.woo<{ id?: number | string }>(store, 'PUT', `/products/${encodeURIComponent(existing.providerId)}`, payload);
        return { providerId: String((updated as any).id ?? existing.providerId) };
      }
    }
    const created = await this.woo<{ id?: number | string }>(store, 'POST', '/products', payload);
    return { providerId: String((created as any).id) };
  }

  override async upsertVariants(store: StoreWithSecrets, ref: RemoteRef, variants: NormalizedVariant[]): Promise<Map<string, RemoteRef>> {
    const out = new Map<string, RemoteRef>();
    for (const v of variants) {
      const rec = v as Record<string, unknown>;
      const payload: Record<string, unknown> = {};
      if (rec.sku !== undefined) payload.sku = rec.sku;
      if (rec.price !== undefined) payload.regular_price = rec.price === null ? '' : String(rec.price);
      if (rec.salePrice !== undefined) payload.sale_price = rec.salePrice === null ? '' : String(rec.salePrice);
      if (rec.isActive !== undefined) payload.status = rec.isActive ? 'publish' : 'private';
      const existingId = typeof rec.__externalVariantId === 'string' ? rec.__externalVariantId : undefined;
      if (existingId) {
        const updated = await this.woo<{ id?: number | string }>(
          store, 'PUT', `/products/${encodeURIComponent(ref.providerId)}/variations/${encodeURIComponent(existingId)}`, payload,
        );
        out.set(String(rec.sku), { providerId: String((updated as any).id ?? existingId) });
        continue;
      }
      const created = await this.woo<{ id?: number | string }>(
        store, 'POST', `/products/${encodeURIComponent(ref.providerId)}/variations`, payload,
      );
      out.set(String(rec.sku), { providerId: String((created as any).id) });
    }
    return out;
  }

  override async ensureMedia(store: StoreWithSecrets, items: NormalizedMedia[]): Promise<Map<string, RemoteRef>> {
    void store;
    // url-fetch model: Woo pulls images from EcoMate's public URL at
    // product upsert time — no separate upload call. Identity = src hash.
    const out = new Map<string, RemoteRef>();
    for (const item of items) {
      const rec = item as unknown as { src: string; hash: string };
      out.set(rec.src, { providerId: `woo-media:${rec.hash}` });
    }
    return out;
  }

  override async setPublication(store: StoreWithSecrets, ref: RemoteRef, state: 'published' | 'draft'): Promise<PushResult> {
    await this.woo(store, 'PUT', `/products/${encodeURIComponent(ref.providerId)}`, { status: state === 'published' ? 'publish' : 'draft' });
    return { ok: true, ref };
  }

  override async deleteProduct(store: StoreWithSecrets, ref: RemoteRef): Promise<PushResult> {
    await this.woo(store, 'DELETE', `/products/${encodeURIComponent(ref.providerId)}?force=true`);
    return { ok: true };
  }

  override async readStockState(store: StoreWithSecrets, ref: RemoteRef): Promise<StockState> {
    const body = await this.woo<{ stock_status?: string }>(store, 'GET', `/products/${encodeURIComponent(ref.providerId)}`);
    return (body as any).stock_status === 'outofstock' ? 'OUT_OF_STOCK' : 'IN_STOCK';
  }

  override async publishStockState(store: StoreWithSecrets, ref: RemoteRef, state: StockState): Promise<PushResult> {
    // Status-only (BR-06): never a quantity, sentinel or placeholder.
    await this.woo(store, 'PUT', `/products/${encodeURIComponent(ref.providerId)}`, {
      stock_status: state === 'IN_STOCK' ? 'instock' : 'outofstock',
    });
    return { ok: true, ref };
  }

  override async fetchOrders(
    store: StoreWithSecrets,
    opts: { since: Date; until: Date; status?: string[]; page: number; pageSize: number },
  ): Promise<{ orders: NormalizedOrder[]; hasMore: boolean }> {
    const params = new URLSearchParams({
      after: opts.since.toISOString(),
      before: opts.until.toISOString(),
      page: String(Math.max(1, opts.page)),
      per_page: String(opts.pageSize),
    });
    if (opts.status && opts.status.length > 0) params.set('status', opts.status.join(','));
    const orders = await this.woo<any[]>(store, 'GET', `/orders?${params.toString()}`);
    const pageSize = opts.pageSize;
    return { orders: orders as NormalizedOrder[], hasMore: orders.length === pageSize };
  }

  override async pushOrderStatus(store: StoreWithSecrets, ref: RemoteRef, target: 'cancelled' | 'completed'): Promise<PushResult> {
    await this.woo(store, 'PUT', `/orders/${encodeURIComponent(ref.providerId)}`, { status: target });
    return { ok: true, ref };
  }

  override async ensureWebhooks(store: StoreWithSecrets, callbackBaseUrl: string): Promise<WebhookRegistrationResult> {
    const topics = ['order.created', 'order.updated', 'product.updated'];
    const existing = await this.woo<any[]>(store, 'GET', '/webhooks?per_page=100').catch(() => []);
    const have = new Set((existing as any[]).map((h) => h.topic));
    for (const topic of topics) {
      if (have.has(topic)) continue;
      await this.woo(store, 'POST', '/webhooks', {
        name: `EcoMate ${topic}`,
        topic,
        delivery_url: `${callbackBaseUrl.replace(/\/+$/, '')}/api/webhooks/stores/woocommerce`,
      });
    }
    return { ok: true, topics };
  }
}
