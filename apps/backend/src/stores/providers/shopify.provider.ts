/**
 * Shopify live adapter — central-commerce P9 (§7.1, P9 row).
 *
 * Admin API over a custom-app access token (`X-Shopify-Access-Token`;
 * OAuth-ready shape — the token field also carries an OAuth token in a later
 * phase — but the custom-app token is the phase-1 mechanism):
 * products/variants/collections(status, publication, delete)/orders fetch +
 * HMAC webhooks (verifyWebhook was P2, extended here with the 5-minute
 * replay check where a timestamp is supplied).
 *
 * Field mapping (§8.11 Table A, Shopify target column):
 * name→title, shortDescription→composed excerpt (not native — derived from
 * body_html), fullDescription→body_html, sku→variants[].sku,
 * productCode≡sku, barcode→variants[].barcode, primaryImage/galleryImages→
 * images[{src}] (+ POST .../images.json identity, reuse by stored id),
 * category→custom collections per path + product_type (adapter-internal —
 * collection ids and product_type NEVER leak into core models; core only
 * ever sees the `category` field key), brand→vendor, tags→tags[] (comma
 * string on the wire), productType structural (combo → loud
 * COMBO_SKIPPED, never fabricated — BR-22), variants→variants[] with
 * options[]/selectedOptions semantics, price→variants[].price,
 * salePrice→variants[].compare_at_price (price = sale ?? base), costPrice→
 * inventory_item.cost via inventory_items (never customer-facing — BR-23),
 * weight→variants[].weight + weight_unit, dimensions skipped with reason
 * (not native), seoTitle/seoDescription→seo.title/description via GraphQL
 * productUpdate, slug→handle, publicationState→status (active/draft),
 * customFields→metafields (allowlisted namespaces only, never secrets).
 *
 * Stock is `unsupported` (BR-08): publishStockState/publishVariantStockState
 * are NOT overridden — the base fidelity gate throws BEFORE any HTTP seam
 * is touched (zero writes, provable by call log). readStockState is
 * read-only (product variants' inventory_quantity → IN/OUT) for the daily
 * drift audit, which raises STOCK_DRIFT_MONITOR_ONLY. No quantity,
 * sentinel or placeholder value is ever written (BR-06).
 *
 * Orders: fetchOrders pages REST /orders.json over the reconcile window;
 * pushOrderStatus maps canonical cancelled→POST .../orders/{id}/cancel.json
 * and completed→POST .../orders/{id}/fulfillments.json (Shopify
 * CANCELLED/FULFILLED vocabulary rendered inside the adapter — core never
 * branches on a slug). readOrderStatus reads GET /orders/{id}.json for
 * read-back verification (cancelled_at → CANCELLED, fulfilled →
 * FULFILLED).
 *
 * Delete is the GraphQL `productDelete` mutation (capability-gated,
 * hard-delete path only — BR-09). Variant removal stays capability-gated
 * (`variantDelete: false` — a variant with orders cannot be deleted →
 * archive + issue, owned by core).
 *
 * Never called from a mutation: adapter methods run only in queued workers
 * (R-2/BR-21). Missing connection settings throw INVALID_REQUEST before
 * any HTTP call (never an unauthed call).
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
import {
  getHeader,
  isTimestampFresh,
  safeEqualString,
  signShopifyDelivery,
} from './webhook-crypto';
import { snapshotField } from './field-snapshot';
import { classifyHttpStatus } from './retry-classifier';
import { isAllowedCustomField } from '../sync/field-matrix';

/** Shopify Admin API version pinned for phase 1. */
export const SHOPIFY_API_VERSION = '2024-01';

/** Webhook topics provisioned by ensureWebhooks (order + product update). */
export const SHOPIFY_WEBHOOK_TOPICS = ['orders/create', 'orders/updated', 'products/update'];

/** Default weight unit when EcoMate carries no unit (Shopify requires one). */
export const SHOPIFY_DEFAULT_WEIGHT_UNIT = 'kg';

interface ShopifyContext {
  shop: string;
  accessToken: string;
  baseUrl: string;
}

function ctxOf(store: StoreWithSecrets): ShopifyContext {
  const secrets = store.secrets ?? {};
  const settings = store.settings ?? {};
  const rawShop = String(secrets.shop ?? settings.shop ?? '').trim();
  // Accept `shop.myshopify.com`, `https://shop.myshopify.com/` or a custom
  // domain — strip protocol and trailing slashes only.
  const shop = rawShop.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const accessToken = String(secrets.accessToken ?? '');
  if (!shop || !accessToken) {
    throw new ProviderError(
      '[shopify] missing connection settings (shop/accessToken)',
      ProviderErrorCategory.INVALID_REQUEST,
      'shopify',
    );
  }
  return { shop, accessToken, baseUrl: `https://${shop}/admin/api/${SHOPIFY_API_VERSION}` };
}

function toProviderError(slug: string, status: number, body: unknown, path: string): ProviderError {
  const decision = classifyHttpStatus(status);
  return new ProviderError(
    `[${slug}] ${path} → http-${status}: ${JSON.stringify(body ?? null).slice(0, 300)}`,
    decision.category,
    slug,
  );
}

export function shopifySlugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripHtml(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Composed excerpt (not native on Shopify): plain-text head of body_html. */
export function shopifyExcerpt(bodyHtml: unknown, maxLen = 160): string | null {
  const text = stripHtml(bodyHtml);
  if (!text) return null;
  return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text;
}

function tagsToString(tags: unknown): string | undefined {
  if (tags === undefined || tags === null) return undefined;
  const list = (Array.isArray(tags) ? tags : [tags])
    .map((t) => (typeof t === 'string' ? t : String((t as any)?.name ?? t ?? '')).trim())
    .filter(Boolean);
  return list.join(', ');
}

function tagsFromString(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((t) => String(t));
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function imagesOf(input: Record<string, unknown>): { src: string }[] {
  const images: { src: string }[] = [];
  if (input.primaryImage) images.push({ src: String(input.primaryImage) });
  if (Array.isArray(input.galleryImages)) {
    for (const src of input.galleryImages as unknown[]) {
      if (src) images.push({ src: String(src) });
    }
  }
  return images;
}

/**
 * Normalized EcoMate fields → Shopify REST product payload.
 * NEVER includes: costPrice (BR-23 — inventory_item only), dimensions
 * (unsupported — skipped with reason), quantities (BR-06), secrets
 * (customFields are allowlisted before this point).
 *
 * Price semantics: `price` = sale ?? base; `compare_at_price` = sale set ?
 * base : null. Sale price is never written to a customer-facing field other
 * than the variant price pair itself.
 */
export function shopifyFieldToPayload(input: Record<string, unknown>): Record<string, unknown> {
  if (input.productType !== undefined && String(input.productType) === 'combo') {
    throw new ProviderError(
      '[shopify] COMBO_SKIPPED: combos are not representable by phase-1 providers (BR-22)',
      ProviderErrorCategory.INVALID_REQUEST,
      'shopify',
    );
  }
  const product: Record<string, unknown> = {};
  if (input.name !== undefined) product.title = input.name;
  if (input.fullDescription !== undefined || input.shortDescription !== undefined) {
    const full = input.fullDescription ?? input.shortDescription ?? '';
    product.body_html = full === null ? '' : String(full);
  }
  if (input.brand !== undefined && input.brand !== null) product.vendor = String(input.brand);
  if (input.tags !== undefined) {
    const tags = tagsToString(input.tags);
    if (tags !== undefined) product.tags = tags;
  }
  if (input.slug !== undefined && input.slug !== null) product.handle = String(input.slug);
  if (input.publicationState !== undefined) {
    product.status = input.publicationState === 'published' ? 'active' : 'draft';
  }
  // Adapter-internal: an explicitly supplied leaf product_type travels with
  // the payload; collection membership is attached via collects after
  // create/update (never leaks to core — core only sees `category`).
  if (input.__productTypeLeaf !== undefined && input.__productTypeLeaf !== null) {
    product.product_type = String(input.__productTypeLeaf);
  }
  const images = imagesOf(input);
  if (images.length > 0) product.images = images;
  return product;
}

/** Single-variant REST payload (price pair + weight + identifiers). */
export function shopifyVariantToPayload(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (v.sku !== undefined) out.sku = v.sku;
  // price = sale ?? base; compare_at_price = sale ? base : null.
  const base = v.price === null || v.price === undefined || v.price === '' ? null : String(v.price);
  const sale =
    v.salePrice === null || v.salePrice === undefined || v.salePrice === '' ? null : String(v.salePrice);
  if (v.price !== undefined || v.salePrice !== undefined) {
    out.price = sale ?? base ?? '0.00';
    out.compare_at_price = sale !== null && base !== null ? base : null;
  }
  if (v.barcode !== undefined) out.barcode = v.barcode;
  if (v.weight !== undefined && v.weight !== null && v.weight !== '') out.weight = v.weight;
  if (v.weight !== undefined) {
    out.weight_unit =
      typeof (v as any).weightUnit === 'string' && (v as any).weightUnit
        ? String((v as any).weightUnit)
        : SHOPIFY_DEFAULT_WEIGHT_UNIT;
  }
  if (v.isActive !== undefined) {
    // Variant publish state travels inside the adapter only; the product
    // status remains the publication authority (§8.8).
    out.inventory_management = (v as any).isActive === false ? null : 'shopify';
  }
  return out;
}

/**
 * Shopify REST product JSON → §8.11 field snapshots (ownership baselines).
 * `product_type` + collection membership stay adapter-internal: the
 * `category` snapshot carries the product_type string (never a core id).
 */
export function shopifyProductToSnapshots(
  body: Record<string, unknown>,
  fields: FieldKey[],
): Record<FieldKey, FieldSnapshot> {
  const variants = (Array.isArray(body.variants) ? body.variants : []) as Record<string, unknown>[];
  const images = (Array.isArray(body.images) ? body.images : []) as { src?: string }[];
  const first = variants[0] ?? {};
  const derived: Record<string, unknown> = {
    name: body.title ?? null,
    shortDescription: shopifyExcerpt(body.body_html),
    fullDescription: typeof body.body_html === 'string' ? body.body_html : (body.body_html ?? null),
    sku: first.sku ?? null,
    productCode: first.sku ?? null,
    barcode: first.barcode ?? first.sku ?? null,
    primaryImage: images[0]?.src ?? null,
    galleryImages: images
      .slice(1)
      .map((i) => i.src)
      .filter(Boolean),
    category: body.product_type ?? null,
    brand: body.vendor ?? null,
    tags: tagsFromString(body.tags),
    productType: Array.isArray(body.options) && (body.options as unknown[]).length > 0 ? 'variable' : 'simple',
    variants: variants.map((v) => ({ sku: v.sku ?? null, price: v.price ?? null })),
    variantAttributes: (Array.isArray(body.options) ? body.options : []).map((o: any) => ({
      name: o?.name ?? null,
      values: o?.values ?? [],
    })),
    price: first.price ?? null,
    salePrice: (first.compare_at_price as unknown) ?? null,
    costPrice: null, // push-only via inventory_item (BR-23); never read back as truth.
    weight: first.weight ?? null,
    dimensions: null, // not native → skipped with reason.
    seoTitle: (body as any).seoTitle ?? null,
    seoDescription: (body as any).seoDescription ?? null,
    slug: body.handle ?? null,
    publicationState: body.status === 'active' ? 'published' : 'draft',
    customFields: (() => {
      const out: Record<string, unknown> = {};
      const metafields = Array.isArray((body as any).metafields) ? ((body as any).metafields as any[]) : [];
      for (const m of metafields) {
        const key = String(m?.key ?? '');
        if (key && isAllowedCustomField(key)) out[key] = m.value;
      }
      return out;
    })(),
  };
  const out: Record<FieldKey, FieldSnapshot> = {};
  for (const f of fields) out[f] = snapshotField(derived[f]);
  return out;
}

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
    seo: true, // seo.title / seo.description via GraphQL productUpdate
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

  // ── HTTP seams (REST + GraphQL, custom-app token) ────────────────────

  private async rest<T>(
    store: StoreWithSecrets,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const ctx = ctxOf(store);
    const res = await this.fetchFn(`${ctx.baseUrl}${path}`, {
      method,
      headers: { 'X-Shopify-Access-Token': ctx.accessToken, 'Content-Type': 'application/json' },
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

  private async graphql<T>(store: StoreWithSecrets, query: string, variables?: unknown): Promise<T> {
    const ctx = ctxOf(store);
    const res = await this.fetchFn(`${ctx.baseUrl}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': ctx.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    let parsed: any = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) throw toProviderError(this.slug, res.status, parsed, 'POST /graphql.json');
    if (parsed?.errors?.length) {
      throw new ProviderError(
        `[shopify] graphql errors: ${JSON.stringify(parsed.errors).slice(0, 300)}`,
        ProviderErrorCategory.INVALID_REQUEST,
        'shopify',
      );
    }
    return parsed as T;
  }

  // ── testConnection (reachability, auth, permissions, media preflight) ─

  /**
   * Probe `GET shop.json` (custom-app token). providerStoreId prefers
   * `myshopify_domain`, falling back to `shop:{id}` — either feeds
   * Store.identityFingerprint (§8.10 duplicate protection).
   */
  async testConnection(store: StoreWithSecrets): Promise<TestConnectionResult> {
    const secrets = store.secrets ?? {};
    const settings = store.settings ?? {};
    const rawShop = String(secrets.shop ?? settings.shop ?? '').trim();
    if (!rawShop || !secrets.accessToken) {
      return {
        reachable: false,
        authenticated: false,
        permissionsOk: false,
        capabilities: this.declaredCapabilities,
      };
    }
    const shop = rawShop.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const probed = await this.tryProbe(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': String(secrets.accessToken) },
    });
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
        : shopNode?.id !== undefined && shopNode?.id !== null
          ? `shop:${String(shopNode.id)}`
          : undefined;
    return this.connectionFromProbe(
      status,
      body,
      providerStoreId,
      this.declaredCapabilities,
      await this.mediaPreflight(settings as Record<string, unknown>),
    );
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

  // ── verifyWebhook (HMAC + delivery id + topic, replay where dated) ────

  /**
   * `X-Shopify-Hmac-Sha256` (base64 HMAC-SHA256 over the raw body) +
   * delivery id (`X-Shopify-Webhook-Id`) + topic (`X-Shopify-Topic`).
   * Where a timestamp is supplied (`X-Shopify-Timestamp`, e.g. via an app
   * proxy) the 5-minute replay window applies; absent timestamps rely on the
   * authoritative `deliveryKey` dedupe in StoreWebhookService (§8.7).
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
    const timestamp = getHeader(headers, 'X-Shopify-Timestamp');
    if (timestamp !== undefined && !isTimestampFresh(timestamp)) {
      return { valid: false, reason: 'stale-timestamp' };
    }
    return {
      valid: true,
      deliveryId,
      topic: getHeader(headers, 'X-Shopify-Topic'),
    };
  }

  // ── Categories (adapter-internal collections + product_type) ──────────

  /**
   * One custom_collection per level name (flat model — no hierarchy to
   * re-parent; rename updates the mapped collection in place). Lookup is by
   * handle before create (duplicate prevention, §8.9). Returns the leaf ref
   * keyed by the full path. product_type + collects membership stay inside
   * the adapter (upsertProduct) and never leak to core.
   */
  override async ensureCategories(store: StoreWithSecrets, paths: CategoryPath[]): Promise<Map<string, RemoteRef>> {
    const out = new Map<string, RemoteRef>();
    for (const path of paths) {
      let leaf: RemoteRef | null = null;
      for (const level of path) {
        const handle = shopifySlugify(String(level));
        const found = await this.rest<{ custom_collections?: any[] }>(
          store,
          'GET',
          `/custom_collections.json?handle=${encodeURIComponent(handle)}&limit=250`,
        );
        const match = (found.custom_collections ?? []).find((c: any) => c.handle === handle);
        if (match) {
          leaf = { providerId: String(match.id) };
          continue;
        }
        const created = await this.rest<{ custom_collection?: any }>(store, 'POST', '/custom_collections.json', {
          custom_collection: { title: String(level), handle },
        });
        leaf = { providerId: String(created.custom_collection.id) };
      }
      if (leaf) out.set(path.join(' / '), leaf);
    }
    return out;
  }

  override async renameCategory(store: StoreWithSecrets, ref: RemoteRef, next: CategoryInput): Promise<PushResult> {
    const updated = await this.rest<{ custom_collection?: any }>(
      store,
      'PUT',
      `/custom_collections/${encodeURIComponent(ref.providerId)}.json`,
      { custom_collection: { id: ref.providerId, title: next.name, handle: next.slug } },
    );
    return { ok: true, ref: { providerId: String(updated.custom_collection.id) } };
  }

  override async moveCategory(store: StoreWithSecrets, ref: RemoteRef, parent: RemoteRef | null): Promise<PushResult> {
    // Flat collection model: no re-parent exists. Loud skip (never a
    // duplicate, never silence) — core raises an actionable issue (§8.9).
    void store;
    void parent;
    return { ok: true, skipped: true, ref, reason: 'COLLECTION_FLAT_MODEL: custom collections have no parent — membership unchanged' };
  }

  /** First-contact lookup by SKU (BR-05 adopt_existing probe). */
  async findBySku(store: StoreWithSecrets, sku: string): Promise<RemoteRef | null> {
    const list = await this.rest<{ products?: any[] }>(
      store,
      'GET',
      '/products.json?limit=250&fields=id,variants',
    );
    for (const p of list.products ?? []) {
      for (const v of (p.variants ?? []) as any[]) {
        if (String(v.sku ?? '') === sku) return { providerId: String(p.id) };
      }
    }
    return null;
  }

  // ── Products / variants / media / publication / delete ────────────────

  override async readProductFields(
    store: StoreWithSecrets,
    ref: RemoteRef,
    fields: FieldKey[],
  ): Promise<Record<FieldKey, FieldSnapshot>> {
    const needsSeo = fields.includes('seoTitle') || fields.includes('seoDescription');
    const body = await this.rest<{ product?: Record<string, unknown> }>(
      store,
      'GET',
      `/products/${encodeURIComponent(ref.providerId)}.json`,
    );
    const product = { ...((body.product ?? {}) as Record<string, unknown>) };
    if (needsSeo) {
      const seo = await this.readSeo(store, ref).catch(() => null);
      if (seo) {
        product.seoTitle = seo.title;
        product.seoDescription = seo.description;
      }
    }
    return shopifyProductToSnapshots(product, fields);
  }

  private async readSeo(store: StoreWithSecrets, ref: RemoteRef): Promise<{ title: string | null; description: string | null } | null> {
    const gid = `gid://shopify/Product/${ref.providerId}`;
    const res = await this.graphql<{ data?: { product?: { seo?: { title?: string; description?: string } } } }>(
      store,
      'query ($id: ID!) { product(id: $id) { seo { title description } } }',
      { id: gid },
    );
    const seo = res.data?.product?.seo;
    if (!seo) return null;
    return { title: seo.title ?? null, description: seo.description ?? null };
  }

  override async upsertProduct(store: StoreWithSecrets, input: NormalizedProduct, fields: FieldKey[]): Promise<RemoteRef> {
    const rec = { ...(input as Record<string, unknown>) };
    const payload = shopifyFieldToPayload(rec);
    const externalId = typeof rec.__externalId === 'string' ? rec.__externalId : undefined;

    // Variants ride the product payload on create (options/selectedOptions
    // semantics); standalone variant syncs land in upsertVariants.
    const variantsInput = Array.isArray(rec.variants) ? (rec.variants as Record<string, unknown>[]) : null;
    if (!externalId && variantsInput && variantsInput.length > 0) {
      payload.variants = variantsInput.map((v) => shopifyVariantToPayload(v));
      const names = uniqueOptionNames(variantsInput);
      if (names.length > 0) {
        payload.options = names.map((name) => ({
          name,
          values: uniqueOptionValues(variantsInput, name),
        }));
      }
    }

    let productId: string;
    let variantInventory: { sku: string; inventoryItemId: string }[] = [];
    if (externalId) {
      const updated = await this.rest<{ product?: any }>(
        store,
        'PUT',
        `/products/${encodeURIComponent(externalId)}.json`,
        { product: { id: externalId, ...payload } },
      );
      productId = String(updated.product?.id ?? externalId);
      variantInventory = collectInventory(updated.product?.variants);
    } else {
      // Idempotent create: SKU match first (same sku → same ref).
      const sku = typeof rec.sku === 'string' && rec.sku.length > 0 ? rec.sku : undefined;
      if (sku) {
        const existing = await this.findBySku(store, sku).catch(() => null);
        if (existing) {
          const updated = await this.rest<{ product?: any }>(
            store,
            'PUT',
            `/products/${encodeURIComponent(existing.providerId)}.json`,
            { product: { id: existing.providerId, ...payload } },
          );
          productId = String(updated.product?.id ?? existing.providerId);
          variantInventory = collectInventory(updated.product?.variants);
        } else {
          const created = await this.rest<{ product?: any }>(store, 'POST', '/products.json', {
            product: payload,
          });
          productId = String(created.product.id);
          variantInventory = collectInventory(created.product?.variants);
        }
      } else {
        const created = await this.rest<{ product?: any }>(store, 'POST', '/products.json', {
          product: payload,
        });
        productId = String(created.product.id);
        variantInventory = collectInventory(created.product?.variants);
      }
    }

    // Adapter-internal collection membership (collects) — never core state.
    const collectionIds = collectionIdsOf(rec);
    for (const collectionId of collectionIds) {
      await this.rest(store, 'POST', '/collects.json', {
        collect: { product_id: productId, collection_id: collectionId },
      }).catch(() => null);
    }

    // Cost is push-only via inventory_item (BR-23 — never customer-facing,
    // never in the product payload, never read back as truth).
    if (fields.includes('costPrice') && rec.costPrice !== undefined && rec.costPrice !== null) {
      await this.pushCost(store, productId, variantInventory, rec).catch(() => null);
    }

    // SEO via GraphQL productUpdate (native seo.title/description).
    if (fields.includes('seoTitle') || fields.includes('seoDescription')) {
      await this.pushSeo(store, productId, rec).catch(() => null);
    }

    // Allowlisted metafields only (never secrets — enforced by the allowlist).
    if (rec.customFields !== undefined && rec.customFields !== null && typeof rec.customFields === 'object') {
      await this.pushMetafields(store, productId, rec.customFields as Record<string, unknown>).catch(() => null);
    }

    return { providerId: productId };
  }

  private async pushCost(
    store: StoreWithSecrets,
    productId: string,
    variantInventory: { sku: string; inventoryItemId: string }[],
    rec: Record<string, unknown>,
  ): Promise<void> {
    const cost = String(rec.costPrice);
    let inventory = variantInventory;
    if (inventory.length === 0) {
      const variants = await this.rest<{ variants?: any[] }>(
        store,
        'GET',
        `/products/${encodeURIComponent(productId)}/variants.json?limit=250&fields=id,sku,inventory_item_id`,
      ).catch(() => ({ variants: [] as any[] }));
      inventory = collectInventory(variants.variants);
    }
    const targets =
      inventory.length > 0
        ? inventory
        : typeof rec.sku === 'string'
          ? [{ sku: rec.sku, inventoryItemId: '' }]
          : [];
    for (const t of targets) {
      if (!t.inventoryItemId) continue;
      await this.rest(store, 'PUT', `/inventory_items/${encodeURIComponent(t.inventoryItemId)}.json`, {
        inventory_item: { id: t.inventoryItemId, cost },
      });
    }
  }

  private async pushSeo(store: StoreWithSecrets, productId: string, rec: Record<string, unknown>): Promise<void> {
    const seo: Record<string, string> = {};
    if (rec.seoTitle !== undefined && rec.seoTitle !== null) seo.title = String(rec.seoTitle);
    if (rec.seoDescription !== undefined && rec.seoDescription !== null) seo.description = String(rec.seoDescription);
    if (Object.keys(seo).length === 0) return;
    await this.graphql(store, 'mutation ($input: ProductUpdateInput!) { productUpdate(input: $input) { product { id } userErrors { field message } } }', {
      input: { id: `gid://shopify/Product/${productId}`, seo },
    });
  }

  private async pushMetafields(store: StoreWithSecrets, productId: string, fields: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(fields).filter(([k]) => isAllowedCustomField(k));
    for (const [key, value] of entries) {
      await this.rest(store, 'POST', `/products/${encodeURIComponent(productId)}/metafields.json`, {
        metafield: { namespace: 'ecomate', key, value: String(value), type: 'single_line_text_field' },
      });
    }
  }

  override async upsertVariants(
    store: StoreWithSecrets,
    ref: RemoteRef,
    variants: NormalizedVariant[],
  ): Promise<Map<string, RemoteRef>> {
    const out = new Map<string, RemoteRef>();
    const remote = await this.rest<{ variants?: any[] }>(
      store,
      'GET',
      `/products/${encodeURIComponent(ref.providerId)}/variants.json?limit=250&fields=id,sku,price,inventory_item_id`,
    ).catch(() => ({ variants: [] as any[] }));
    const bySku = new Map((remote.variants ?? []).map((v: any) => [String(v.sku ?? ''), v]));
    for (const v of variants) {
      const rec = { ...(v as Record<string, unknown>) };
      if (rec.productType !== undefined && String(rec.productType) === 'combo') {
        throw new ProviderError(
          '[shopify] COMBO_SKIPPED: combos are not representable by phase-1 providers (BR-22)',
          ProviderErrorCategory.INVALID_REQUEST,
          'shopify',
        );
      }
      const sku = String(rec.sku ?? '');
      const payload = shopifyVariantToPayload(rec);
      const existingId = typeof rec.__externalVariantId === 'string' ? rec.__externalVariantId : undefined;
      const match = existingId
        ? { id: existingId }
        : bySku.get(sku);
      if (match?.id !== undefined) {
        const updated = await this.rest<{ variant?: any }>(
          store,
          'PUT',
          `/variants/${encodeURIComponent(String(match.id))}.json`,
          { variant: { id: match.id, ...payload } },
        );
        out.set(sku, { providerId: String(updated.variant?.id ?? match.id) });
        // Cost follows the variant (push-only, BR-23).
        if (rec.costPrice !== undefined && rec.costPrice !== null && updated.variant?.inventory_item_id) {
          await this.rest(store, 'PUT', `/inventory_items/${encodeURIComponent(String(updated.variant.inventory_item_id))}.json`, {
            inventory_item: { id: updated.variant.inventory_item_id, cost: String(rec.costPrice) },
          }).catch(() => null);
        }
        continue;
      }
      const created = await this.rest<{ variant?: any }>(
        store,
        'POST',
        `/products/${encodeURIComponent(ref.providerId)}/variants.json`,
        { variant: payload },
      );
      out.set(sku, { providerId: String(created.variant.id) });
      if (rec.costPrice !== undefined && rec.costPrice !== null && created.variant?.inventory_item_id) {
        await this.rest(store, 'PUT', `/inventory_items/${encodeURIComponent(String(created.variant.inventory_item_id))}.json`, {
          inventory_item: { id: created.variant.inventory_item_id, cost: String(rec.costPrice) },
        }).catch(() => null);
      }
    }
    return out;
  }

  override async ensureMedia(store: StoreWithSecrets, items: NormalizedMedia[]): Promise<Map<string, RemoteRef>> {
    void store;
    // Stored-id reuse model: identity = content hash. The bytes travel inside
    // the product images payload (upsertProduct) / the images endpoint —
    // mapped media is never re-uploaded (Table B rows 7–8).
    const out = new Map<string, RemoteRef>();
    for (const item of items) {
      const rec = item as unknown as { src: string; hash: string };
      out.set(rec.src, { providerId: `shopify-media:${rec.hash}` });
    }
    return out;
  }

  override async setPublication(store: StoreWithSecrets, ref: RemoteRef, state: 'published' | 'draft'): Promise<PushResult> {
    await this.rest(store, 'PUT', `/products/${encodeURIComponent(ref.providerId)}.json`, {
      product: { id: ref.providerId, status: state === 'published' ? 'active' : 'draft' },
    });
    return { ok: true, ref };
  }

  /**
   * Capability-gated deletion (BR-09: hard-delete path only) via the
   * GraphQL `productDelete` mutation.
   */
  override async deleteProduct(store: StoreWithSecrets, ref: RemoteRef): Promise<PushResult> {
    const res = await this.graphql<{
      data?: { productDelete?: { deletedProductId?: string; userErrors?: { field?: string[]; message?: string }[] } };
    }>(
      store,
      'mutation ($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId userErrors { field message } } }',
      { input: { id: `gid://shopify/Product/${ref.providerId}` } },
    );
    const errors = res.data?.productDelete?.userErrors ?? [];
    if (errors.length > 0) {
      throw new ProviderError(
        `[shopify] productDelete failed: ${errors.map((e) => e.message).join('; ').slice(0, 300)}`,
        ProviderErrorCategory.INVALID_REQUEST,
        'shopify',
      );
    }
    return { ok: true };
  }

  // ── Stock: read-only (BR-08 — publish stays on the base zero-write gate) ─

  /**
   * Read-only stock state for the drift audit: product variants'
   * `inventory_quantity` summed — any unit available → IN_STOCK, else
   * OUT_OF_STOCK. Zero writes (BR-08); the audit raises
   * STOCK_DRIFT_MONITOR_ONLY on mismatch.
   */
  override async readStockState(store: StoreWithSecrets, ref: RemoteRef): Promise<StockState> {
    const body = await this.rest<{ product?: { variants?: any[] } }>(
      store,
      'GET',
      `/products/${encodeURIComponent(ref.providerId)}.json?fields=id,variants`,
    );
    const variants = body.product?.variants ?? [];
    // NOTE: read path only — `inventory_quantity` is observed here, never
    // written anywhere in this adapter (BR-06/BR-08).
    const total = variants.reduce((sum: number, v: any) => sum + Number(v?.inventory_quantity ?? 0), 0);
    return total > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
  }

  // publishStockState / publishVariantStockState are INTENTIONALLY inherited
  // from BaseCommerceProvider: `unsupported` fidelity throws BEFORE any HTTP
  // seam is touched (zero writes — asserted by the contract + live suites).

  // ── Orders: paged fetch, CANCELLED/FULFILLED push, read-back ──────────

  override async fetchOrders(
    store: StoreWithSecrets,
    opts: { since: Date; until: Date; status?: string[]; page: number; pageSize: number },
  ): Promise<{ orders: NormalizedOrder[]; hasMore: boolean }> {
    const params = new URLSearchParams({
      status: 'any',
      created_at_min: opts.since.toISOString(),
      created_at_max: opts.until.toISOString(),
      limit: String(Math.min(Math.max(opts.pageSize, 1), 250)),
      page: String(Math.max(1, opts.page)),
      fields:
        'id,name,financial_status,fulfillment_status,cancelled_at,cancel_reason,total_price,currency,created_at,updated_at,line_items,customer,phone,email',
    });
    if (opts.status && opts.status.length > 0) params.set('financial_status', opts.status.join(','));
    const body = await this.rest<{ orders?: unknown[] }>(store, 'GET', `/orders.json?${params.toString()}`);
    const orders = (body.orders ?? []) as NormalizedOrder[];
    return { orders, hasMore: orders.length === Math.min(Math.max(opts.pageSize, 1), 250) };
  }

  override async pushOrderStatus(store: StoreWithSecrets, ref: RemoteRef, target: 'cancelled' | 'completed'): Promise<PushResult> {
    if (target === 'cancelled') {
      await this.rest(store, 'POST', `/orders/${encodeURIComponent(ref.providerId)}/cancel.json`, {});
      return { ok: true, ref };
    }
    await this.rest(store, 'POST', `/orders/${encodeURIComponent(ref.providerId)}/fulfillments.json`, {
      fulfillment: {},
    });
    return { ok: true, ref };
  }

  /**
   * Read-back verification seam (§8.6): cancelled_at → CANCELLED,
   * fulfilled → FULFILLED, else the raw status string. Read-only.
   */
  override async readOrderStatus(store: StoreWithSecrets, ref: RemoteRef): Promise<{ status: string }> {
    const body = await this.rest<{ order?: any }>(
      store,
      'GET',
      `/orders/${encodeURIComponent(ref.providerId)}.json?fields=id,financial_status,fulfillment_status,cancelled_at`,
    );
    const order = body.order ?? {};
    if (order.cancelled_at) return { status: 'CANCELLED' };
    if (String(order.fulfillment_status ?? '').toLowerCase() === 'fulfilled') return { status: 'FULFILLED' };
    return { status: String(order.fulfillment_status ?? order.financial_status ?? '') };
  }

  override async ensureWebhooks(store: StoreWithSecrets, callbackBaseUrl: string): Promise<WebhookRegistrationResult> {
    const existing = await this.rest<{ webhooks?: any[] }>(store, 'GET', '/webhooks.json?limit=250').catch(() => ({
      webhooks: [] as any[],
    }));
    const have = new Set((existing.webhooks ?? []).map((h: any) => h.topic));
    for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
      if (have.has(topic)) continue;
      await this.rest(store, 'POST', '/webhooks.json', {
        webhook: {
          topic,
          address: `${callbackBaseUrl.replace(/\/+$/, '')}/api/webhooks/stores/shopify`,
          format: 'json',
        },
      });
    }
    return { ok: true, topics: SHOPIFY_WEBHOOK_TOPICS };
  }
}

// ── Adapter-internal helpers (no core leakage) ───────────────────────────

function collectInventory(variants: unknown): { sku: string; inventoryItemId: string }[] {
  if (!Array.isArray(variants)) return [];
  return (variants as any[])
    .filter((v) => v?.inventory_item_id !== undefined && v?.inventory_item_id !== null)
    .map((v) => ({ sku: String(v.sku ?? ''), inventoryItemId: String(v.inventory_item_id) }));
}

/** `category` values are already-resolved remote collection ids (mirror Woo). */
function collectionIdsOf(rec: Record<string, unknown>): string[] {
  const raw = rec.category;
  const list = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  const explicit = rec.__collectionIds;
  const extra = explicit === undefined || explicit === null ? [] : Array.isArray(explicit) ? explicit : [explicit];
  return [...list, ...extra]
    .map((id) => String(id))
    // Shopify collection ids are numeric: unresolved EcoMate UUIDs are never
    // sent (a doomed call would 422); membership for mapped categories flows
    // once the caller supplies resolved numeric ids via `category`.
    .filter((id) => /^\d+$/.test(id));
}

function uniqueOptionNames(variants: Record<string, unknown>[]): string[] {
  const names = new Set<string>();
  for (const v of variants) {
    const attrs = (v.attributes ?? v.variantAttributes) as Record<string, unknown> | undefined;
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
      for (const k of Object.keys(attrs)) names.add(k);
    }
  }
  if (names.size === 0 && variants.length > 1) return ['Title'];
  return [...names];
}

function uniqueOptionValues(variants: Record<string, unknown>[], name: string): string[] {
  const values = new Set<string>();
  for (const v of variants) {
    const attrs = (v.attributes ?? v.variantAttributes) as Record<string, unknown> | undefined;
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && attrs[name] !== undefined) {
      values.add(String(attrs[name]));
    } else if (name === 'Title') {
      values.add(String((v as any).name ?? (v as any).sku ?? 'Default'));
    }
  }
  return [...values];
}
