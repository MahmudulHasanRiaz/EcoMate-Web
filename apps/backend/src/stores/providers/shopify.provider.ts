/**
 * Shopify live adapter — central-commerce P9 (§7.1, P9 row).
 *
 * Admin API over Client Credentials Grant (`X-Shopify-Access-Token`;
 * per current Shopify docs the legacy admin-created custom-app static token
 * is no longer creatable — auth is per-store {shop, clientId, clientSecret}
 * → POST https://{shop}/admin/oauth/access_token (form-urlencoded
 * `grant_type=client_credentials`) → short-lived access token, cached per
 * store with 60s early refresh):
 * products/variants/collections(status, publication, delete)/orders fetch +
 * HMAC webhooks (verifyWebhook was P2, extended here with the 5-minute
 * replay check where a timestamp is supplied). Webhook HMAC secret =
 * `secrets.webhookSecret ?? secrets.clientSecret` (Shopify signs with the
 * app's client secret when no separate webhook secret is configured).
 *
 * Token exchange works ONLY when the app and the store share the same
 * Shopify Dev Dashboard organization — an org mismatch surfaces as a
 * PERMANENT (never-retried) `shop_not_permitted`/`invalid_client` error;
 * this constraint is surfaced in error text, never worked around in code.
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
 * Stock is the P13 ERP projection (`quantized-capped`, SUPERSEDES the
 * P1–P12 BR-08 zero-write stance — see
 * docs/central-commerce/P13-ERP-STOCK-PROJECTION.md): ERP > threshold →
 * capped quantity (threshold, default 5) via `InventoryLevel.set`
 * (tracked, deny policy — selling stops at the cap, oversell impossible);
 * 1–5 → actual quantity in real time; 0 → quantity 0 (selling stops).
 * Location strategy: first location from `GET /locations.json`, cached per
 * store (a per-store location override is out of scope, noted here).
 * `inventory_management: 'shopify'` (tracked) is set on push when absent.
 * Reads stay read-only (product variants' `inventory_quantity` → IN/OUT)
 * for the drift audit on `unsupported` bridges.
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

/**
 * Shopify Admin API version pinned for all REST + GraphQL calls and for
 * webhook `api_version`.
 *
 * - `2026-07` is the latest stable (supported until 2026-07-16 … 2027-07-16
 *   per Shopify's 12-month window — re-pin quarterly). It MUST match the
 *   version set in the Dev Dashboard app config; a mismatch means webhooks
 *   serialize payloads under a different version than the code expects.
 * - The previous pin (`2024-01`) is unsupported: Shopify fall-forwards such
 *   requests to the oldest accessible stable, silently changing behavior.
 *   testConnection now reports the served version so fall-forward is loud.
 * - REST Admin API is legacy/maintenance-mode since 2024-10 and the
 *   products/variants endpoints are deprecated (functional for custom apps
 *   within the 100-variant / 3-option cap — enforced below via
 *   assertRestVariantLimit; over-cap products raise an explicit issue
 *   instead of a half-written remote product).
 */
export const SHOPIFY_API_VERSION = '2026-07';

/** REST variant/option ceiling for deprecated products/variants endpoints. */
export const SHOPIFY_REST_VARIANT_LIMIT = 100;
export const SHOPIFY_REST_OPTION_LIMIT = 3;

/** Webhook topics provisioned by ensureWebhooks (order + product update). */
export const SHOPIFY_WEBHOOK_TOPICS = ['orders/create', 'orders/updated', 'products/update'];

/** Default weight unit when EcoMate carries no unit (Shopify requires one). */
export const SHOPIFY_DEFAULT_WEIGHT_UNIT = 'kg';

/** OAuth token endpoint path (Client Credentials Grant). */
export const SHOPIFY_TOKEN_PATH = '/admin/oauth/access_token';

/** Fallback token lifetime (the endpoint always returns `expires_in: 86399`). */
export const SHOPIFY_TOKEN_EXPIRY_SECONDS = 86399;

/** Cached tokens refresh this far before expiry (stale tokens never ship). */
const SHOPIFY_TOKEN_EARLY_REFRESH_MS = 60_000;

/**
 * Org-mismatch constraint (authoritative per current Shopify docs): Client
 * Credentials tokens issue ONLY when the app and the store share a Dev
 * Dashboard organization. Surfaced in error text, never worked around.
 */
const SHOPIFY_ORG_MISMATCH_HINT =
  'the app and the store must belong to the same Shopify Dev Dashboard organization ' +
  '(verify the Client ID/Secret belong to an app in the store\u2019s org)';

interface ShopifyContext {
  shop: string;
  baseUrl: string;
}

interface ShopifyTokenEntry {
  token: string;
  expiresAtMs: number;
  scope?: string;
}

function ctxOf(store: StoreWithSecrets): ShopifyContext {
  const secrets = store.secrets ?? {};
  const settings = store.settings ?? {};
  // Legacy static custom-app tokens are no longer creatable and are never
  // silently used: a stored accessToken is an explicit reconnect signal.
  if (String(secrets.accessToken ?? '').trim()) {
    throw new ProviderError(
      '[shopify] client credentials required: reconnect with Client ID + Client Secret (Client Credentials Grant)',
      ProviderErrorCategory.INVALID_REQUEST,
      'shopify',
    );
  }
  const rawShop = String(secrets.shop ?? settings.shop ?? '').trim();
  // Accept `shop.myshopify.com`, `https://shop.myshopify.com/` or a custom
  // domain — strip protocol and trailing slashes only.
  const shop = rawShop.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const clientId = String(secrets.clientId ?? '').trim();
  const clientSecret = String(secrets.clientSecret ?? '').trim();
  if (!shop || !clientId || !clientSecret) {
    throw new ProviderError(
      '[shopify] missing connection settings (shop/clientId/clientSecret)',
      ProviderErrorCategory.INVALID_REQUEST,
      'shopify',
    );
  }
  return { shop, baseUrl: `https://${shop}/admin/api/${SHOPIFY_API_VERSION}` };
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

/**
 * REST products/variants endpoints are deprecated (maintenance mode) and
 * refuse more than 100 variants / 3 options per product. Fail loudly with
 * an explicit issue instead of a half-written remote product.
 */
function assertRestVariantLimit(variants: Record<string, unknown>[]): void {
  if (variants.length > SHOPIFY_REST_VARIANT_LIMIT) {
    throw new ProviderError(
      `[shopify] VARIANT_LIMIT_EXCEEDED: product has ${variants.length} variants, REST supports ${SHOPIFY_REST_VARIANT_LIMIT} (GraphQL migration required)`,
      ProviderErrorCategory.INVALID_REQUEST,
      'shopify',
    );
  }
  if (uniqueOptionNames(variants).length > SHOPIFY_REST_OPTION_LIMIT) {
    throw new ProviderError(
      `[shopify] VARIANT_LIMIT_EXCEEDED: product has more than ${SHOPIFY_REST_OPTION_LIMIT} options (GraphQL migration required)`,
      ProviderErrorCategory.INVALID_REQUEST,
      'shopify',
    );
  }
}

/**
 * Simple-product default variant. EcoMate carries sku/price at the product
 * level for simple products, but Shopify nests them on (auto-created)
 * variants — without this synthesis a simple-product push lands with an
 * empty SKU and price 0.00. Returns null when the input carries neither.
 */
function defaultVariantFromProduct(rec: Record<string, unknown>): Record<string, unknown> | null {
  if (rec.sku === undefined && rec.price === undefined && rec.salePrice === undefined) {
    return null;
  }
  return shopifyVariantToPayload({
    sku: rec.sku,
    price: rec.price,
    salePrice: rec.salePrice,
    barcode: rec.barcode,
    weight: rec.weight,
  });
}

/** Composed excerpt (not native on Shopify): plain-text head of body_html. */export function shopifyExcerpt(bodyHtml: unknown, maxLen = 160): string | null {
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
    stockStatusFidelity: 'quantized-capped', // P13: capped qty (see header)
    stockQuantity: true, // native InventoryLevel projection
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

  // ── Client Credentials token acquisition (per-store cache) ──────────

  /**
   * Short-lived Admin API tokens, cached per store id with 60s early
   * refresh. Maps are instance-scoped (each test constructs its own
   * provider, so token state never leaks between tests or stores).
   */
  private readonly tokenCache = new Map<string, ShopifyTokenEntry>();
  private readonly tokenInflight = new Map<string, Promise<string>>();

  /**
   * Resolve the bearer for one store. Concurrent callers coalesce onto a
   * single in-flight exchange (single flight); `forceRefresh` bypasses a
   * fresh cache entry (the 401 retry path) but still joins an in-flight
   * exchange rather than opening a second one.
   */
  private async resolveAccessToken(
    store: StoreWithSecrets,
    opts?: { forceRefresh?: boolean },
  ): Promise<string> {
    const secrets = store.secrets ?? {};
    if (String(secrets.accessToken ?? '').trim()) {
      throw new ProviderError(
        '[shopify] client credentials required: reconnect with Client ID + Client Secret (Client Credentials Grant)',
        ProviderErrorCategory.INVALID_REQUEST,
        'shopify',
      );
    }
    const inflight = this.tokenInflight.get(store.id);
    if (inflight) return inflight;
    if (!opts?.forceRefresh) {
      const cached = this.tokenCache.get(store.id);
      if (cached && Date.now() < cached.expiresAtMs - SHOPIFY_TOKEN_EARLY_REFRESH_MS) {
        return cached.token;
      }
    }
    const exchange = this.exchangeToken(store).finally(() => {
      this.tokenInflight.delete(store.id);
    });
    this.tokenInflight.set(store.id, exchange);
    return exchange;
  }

  /**
   * POST https://{shop}/admin/oauth/access_token (form-urlencoded
   * `grant_type=client_credentials`) → `{access_token, expires_in
   * (always 86399), scope}`. Exchange failure is TEMPORARY (retryable)
   * EXCEPT `shop_not_permitted`/`invalid_client`, which is PERMANENT
   * (org mismatch — no retry loop). The request body carries the client
   * secret and is never echoed in any error.
   */
  private async exchangeToken(store: StoreWithSecrets): Promise<string> {
    const ctx = ctxOf(store);
    const secrets = store.secrets ?? {};
    const clientId = String(secrets.clientId ?? '').trim();
    const clientSecret = String(secrets.clientSecret ?? '').trim();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString();
    let res: { status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string> };
    try {
      res = await this.fetchFn(`https://${ctx.shop}${SHOPIFY_TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (err) {
      throw new ProviderError(
        `[shopify] token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
        ProviderErrorCategory.TEMPORARY_FAILURE,
        'shopify',
        err,
      );
    }
    // NOTE: fetch bodies are single-use — read text ONCE, then JSON-parse
    // manually. Calling res.json() first consumes the stream; a later
    // res.text() throws, which hid HTML OAuth refusals as TEMPORARY.
    let rawText = '';
    try {
      rawText = await res.text();
    } catch {
      rawText = '';
    }
    let parsed: any = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const detail = JSON.stringify(parsed ?? null).slice(0, 300);
      if (/invalid_client|shop_not_permitted/i.test(detail)) {
        throw new ProviderError(
          `[shopify] token exchange failed (org mismatch): ${SHOPIFY_ORG_MISMATCH_HINT} — ${detail}`,
          ProviderErrorCategory.INVALID_REQUEST,
          'shopify',
        );
      }
      // Shopify renders some OAuth refusals (e.g. app_not_installed) as an
      // HTML error page with `Oauth error <code>` in the <title> — sniff the
      // code so the wizard shows an actionable message instead of a retry.
      // (rawText was read once above; the stream is already consumed.)
      const oauthCode = /Oauth error ([A-Za-z0-9_]+)/.exec(rawText)?.[1];
      if (oauthCode) {
        throw new ProviderError(
          `[shopify] token exchange refused: ${oauthCode} — install the app on the store (same Dev Dashboard organization) and approve the app version, then retry`,
          ProviderErrorCategory.INVALID_REQUEST,
          'shopify',
        );
      }
      throw new ProviderError(
        `[shopify] token exchange → http-${res.status}: ${detail}`,
        ProviderErrorCategory.TEMPORARY_FAILURE,
        'shopify',
      );
    }
    const token = typeof parsed?.access_token === 'string' ? parsed.access_token : '';
    if (!token) {
      throw new ProviderError(
        '[shopify] token exchange returned no access_token',
        ProviderErrorCategory.TEMPORARY_FAILURE,
        'shopify',
      );
    }
    const ttl = Number(parsed?.expires_in);
    const expiresIn = Number.isFinite(ttl) && ttl > 0 ? ttl : SHOPIFY_TOKEN_EXPIRY_SECONDS;
    this.tokenCache.set(store.id, {
      token,
      expiresAtMs: Date.now() + expiresIn * 1000,
      ...(typeof parsed?.scope === 'string' ? { scope: parsed.scope } : {}),
    });
    return token;
  }

  // ── HTTP seams (REST + GraphQL, Client Credentials bearer) ─────────────

  private async rest<T>(
    store: StoreWithSecrets,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const ctx = ctxOf(store);
    const call = async (token: string) => {
      const res = await this.fetchFn(`${ctx.baseUrl}${path}`, {
        method,
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      return { res, parsed };
    };
    let token = await this.resolveAccessToken(store);
    let { res, parsed } = await call(token);
    if (res.status === 401) {
      // Stale/revoked bearer → ONE re-exchange + retry, then classify.
      this.tokenCache.delete(store.id);
      token = await this.resolveAccessToken(store, { forceRefresh: true });
      ({ res, parsed } = await call(token));
    }
    if (!res.ok) throw toProviderError(this.slug, res.status, parsed, `${method} ${path}`);
    return parsed as T;
  }

  /**
   * GET variant returning response headers (cursor pagination reads the
   * RFC5988 `Link` header — `rest()` discards headers by design).
   */
  private async getWithHeaders<T>(
    store: StoreWithSecrets,
    path: string,
  ): Promise<{ data: T; link?: string }> {
    const ctx = ctxOf(store);
    const call = async (token: string) => {
      const res = await this.fetchFn(`${ctx.baseUrl}${path}`, {
        method: 'GET',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      });
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      return { res, parsed };
    };
    let token = await this.resolveAccessToken(store);
    let { res, parsed } = await call(token);
    if (res.status === 401) {
      this.tokenCache.delete(store.id);
      token = await this.resolveAccessToken(store, { forceRefresh: true });
      ({ res, parsed } = await call(token));
    }
    if (!res.ok) throw toProviderError(this.slug, res.status, parsed, `GET ${path}`);
    return { data: parsed as T, link: res.headers?.get?.('link') ?? undefined };
  }

  /** Next-page cursor from an RFC5988 Link header (`rel="next"`). */
  private nextPageInfo(link: string | undefined): string | null {
    if (!link) return null;
    const m = /<[^>]*[?&]page_info=([^>&]+)>;\s*rel="next"/.exec(link);
    return m ? decodeURIComponent(m[1]) : null;
  }

  private async graphql<T>(store: StoreWithSecrets, query: string, variables?: unknown): Promise<T> {
    const ctx = ctxOf(store);
    const call = async (token: string) => {
      const res = await this.fetchFn(`${ctx.baseUrl}/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      let parsed: any = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      return { res, parsed };
    };
    let token = await this.resolveAccessToken(store);
    let { res, parsed } = await call(token);
    if (res.status === 401) {
      this.tokenCache.delete(store.id);
      token = await this.resolveAccessToken(store, { forceRefresh: true });
      ({ res, parsed } = await call(token));
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
   * Probe `GET shop.json` (Client Credentials bearer). providerStoreId prefers
   * `myshopify_domain`, falling back to `shop:{id}` — either feeds
   * Store.identityFingerprint (§8.10 duplicate protection).
   *
   * A stored legacy static `accessToken` throws INVALID_REQUEST (reconnect
   * with Client ID + Client Secret) instead of probing — it is never
   * silently used. A failed token exchange maps to unreachable data when
   * TEMPORARY, but a PERMANENT org mismatch rethrows loud (the wizard must
   * surface the Dev Dashboard constraint).
   */
  async testConnection(store: StoreWithSecrets): Promise<TestConnectionResult> {
    const secrets = store.secrets ?? {};
    const settings = store.settings ?? {};
    if (String(secrets.accessToken ?? '').trim()) {
      throw new ProviderError(
        '[shopify] client credentials required: reconnect with Client ID + Client Secret (Client Credentials Grant)',
        ProviderErrorCategory.INVALID_REQUEST,
        'shopify',
      );
    }
    const rawShop = String(secrets.shop ?? settings.shop ?? '').trim();
    if (!rawShop || !secrets.clientId || !secrets.clientSecret) {
      return {
        reachable: false,
        authenticated: false,
        permissionsOk: false,
        capabilities: this.declaredCapabilities,
      };
    }
    const shop = rawShop.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    let token: string;
    try {
      token = await this.resolveAccessToken(store);
    } catch (err) {
      if (err instanceof ProviderError && err.category === ProviderErrorCategory.INVALID_REQUEST) {
        throw err;
      }
      return {
        reachable: false,
        authenticated: false,
        permissionsOk: false,
        capabilities: this.declaredCapabilities,
      };
    }
    const probed = await this.tryProbe(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token },
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
    const { status, body, headers } = probed;
    const shopNode = (body as any)?.shop as Record<string, unknown> | undefined;
    const providerStoreId =
      shopNode?.myshopify_domain !== undefined
        ? String(shopNode.myshopify_domain)
        : shopNode?.id !== undefined && shopNode?.id !== null
          ? `shop:${String(shopNode.id)}`
          : undefined;
    // Fall-forward detection: an unsupported pin is silently served by the
    // oldest accessible stable. The wizard surfaces served !== requested.
    const served = headers?.get('x-shopify-api-version') ?? undefined;
    const apiVersion = {
      requested: SHOPIFY_API_VERSION,
      ...(served ? { served } : {}),
      fallForward: served !== undefined && served !== SHOPIFY_API_VERSION,
    };
    return this.connectionFromProbe(
      status,
      body,
      providerStoreId,
      this.declaredCapabilities,
      await this.mediaPreflight(settings as Record<string, unknown>),
      apiVersion,
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
   * The HMAC secret is `secrets.webhookSecret ?? secrets.clientSecret`
   * (Shopify signs with the app's client secret when no separate webhook
   * secret is configured). Where a timestamp is supplied
   * (`X-Shopify-Timestamp`, e.g. via an app proxy) the 5-minute replay
   * window applies; absent timestamps rely on the authoritative
   * `deliveryKey` dedupe in StoreWebhookService (§8.7).
   */
  verifyWebhook(
    store: StoreWithSecrets,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookVerification {
    const secret = String(store.secrets?.webhookSecret ?? store.secrets?.clientSecret ?? '');
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
      assertRestVariantLimit(variantsInput);
      // Structural gate (Table B row 14 spirit): Shopify requires options
      // for multi-variant products. Attribute-less variant sets 422 either
      // way (empty options, or option-less variants under options) — block
      // pre-HTTP with an actionable issue instead of a half-written remote
      // product. Single attribute-less variants omit `options` (valid).
      if (variantsInput.length > 1 && !variantsHaveAttributes(variantsInput)) {
        throw new ProviderError(
          '[shopify] VARIANT_ATTRIBUTES_REQUIRED: multi-variant products need variant attributes (options) — assign attributes to the variants in EcoMate before distribution',
          ProviderErrorCategory.INVALID_REQUEST,
          'shopify',
        );
      }
      // Option order is positional: optionN on each variant must match the
      // Nth product-level option, or Shopify 422s ("options must have
      // corresponding variants").
      const optionNames = variantsHaveAttributes(variantsInput)
        ? uniqueOptionNames(variantsInput)
        : [];
      payload.variants = variantsInput.map((v) => {
        const base = shopifyVariantToPayload(v);
        const attrs = ((v as any).attributes ?? (v as any).variantAttributes) as
          | Record<string, unknown>
          | undefined;
        optionNames.forEach((name, i) => {
          const val =
            attrs && typeof attrs === 'object' && !Array.isArray(attrs)
              ? (attrs as Record<string, unknown>)[name]
              : undefined;
          if (val !== undefined && val !== null && String(val) !== '') {
            (base as any)[`option${i + 1}`] = String(val);
          }
        });
        return base;
      });
      if (optionNames.length > 0) {
        payload.options = optionNames.map((name) => ({
          name,
          values: uniqueOptionValues(variantsInput, name),
        }));
      }
    } else if (!externalId) {
      // Simple product: ride sku/price on the default variant.
      const fallback = defaultVariantFromProduct(rec);
      if (fallback) payload.variants = [fallback];
    }

    let productId: string;
    let variantInventory: { sku: string; inventoryItemId: string }[] = [];
    // Simple-product price/sku ride the default variant (read live: PUT
    // needs the remote variant id, so one bounded read per update).
    const attachDefaultVariant = async (pid: string): Promise<void> => {
      if (variantsInput || !fields.some((f) => f === 'price' || f === 'salePrice' || f === 'sku')) {
        return;
      }
      const fallback = defaultVariantFromProduct(rec);
      if (!fallback) return;
      const remote = await this.rest<{ variants?: any[] }>(
        store,
        'GET',
        `/products/${encodeURIComponent(pid)}/variants.json?limit=250&fields=id`,
      ).catch(() => ({ variants: [] as any[] }));
      const first = (remote.variants ?? [])[0];
      if (first?.id !== undefined) {
        (payload as any).variants = [{ id: first.id, ...fallback }];
      }
    };
    if (externalId) {
      await attachDefaultVariant(externalId);
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
          await attachDefaultVariant(existing.providerId);
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
    assertRestVariantLimit(
      (variants as unknown[]).map((v) => ({ ...(v as Record<string, unknown>) })),
    );
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

  // ── Stock: P13 quantized-capped projection (read + quantity write) ───

  /**
   * Read-only stock state for the drift audit: product variants'
   * `inventory_quantity` summed — any unit available → IN_STOCK, else
   * OUT_OF_STOCK.
   */
  override async readStockState(store: StoreWithSecrets, ref: RemoteRef): Promise<StockState> {
    const body = await this.rest<{ product?: { variants?: any[] } }>(
      store,
      'GET',
      `/products/${encodeURIComponent(ref.providerId)}.json?fields=id,variants`,
    );
    const variants = body.product?.variants ?? [];
    // NOTE: read path only — `inventory_quantity` is observed here; writes
    // travel exclusively through publishStockQuantity below (P13).
    const total = variants.reduce((sum: number, v: any) => sum + Number(v?.inventory_quantity ?? 0), 0);
    return total > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
  }

  /**
   * P13 quantity read-back for verify-after-push: summed
   * `inventory_quantity` across the product's variants, or null when the
   * product cannot be read (engine falls back to a status read-back).
   */
  async readStockQuantity(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<number | null> {
    try {
      const body = await this.rest<{ product?: { variants?: any[] } }>(
        store,
        'GET',
        `/products/${encodeURIComponent(ref.providerId)}.json?fields=id,variants`,
      );
      const variants = body.product?.variants ?? [];
      if (!Array.isArray(variants) || variants.length === 0) return null;
      return variants.reduce((sum: number, v: any) => sum + Number(v?.inventory_quantity ?? 0), 0);
    } catch {
      return null;
    }
  }

  async readVariantStockQuantity(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): Promise<number | null> {
    try {
      const item = await this.variantNode(store, parentRef, variantRef);
      const q = Number((item as any)?.inventory_quantity);
      return Number.isFinite(q) ? q : null;
    } catch {
      return null;
    }
  }

  /**
   * Location strategy (P13): the FIRST location from `GET /locations.json`,
   * cached per store id (instance-scoped like the token cache, so tests
   * never leak locations between stores). A per-store location override is
   * explicitly out of scope — noted here so a future override has one seam
   * to extend (`resolveLocationId`).
   */
  private readonly locationCache = new Map<string, string>();

  async resolveLocationId(store: StoreWithSecrets): Promise<string> {
    const cached = this.locationCache.get(store.id);
    if (cached) return cached;
    const body = await this.rest<{ locations?: any[] }>(store, 'GET', '/locations.json?limit=250');
    const first = (body.locations ?? [])[0];
    if (first?.id === undefined || first?.id === null) {
      throw new ProviderError(
        '[shopify] SHOPIFY_NO_LOCATION: the store exposes no locations — stock projection has no target',
        ProviderErrorCategory.INVALID_REQUEST,
        'shopify',
      );
    }
    const id = String(first.id);
    this.locationCache.set(store.id, id);
    return id;
  }

  /** Test seam: forget the cached location (tests assert the re-fetch). */
  clearLocationCache(storeId?: string): void {
    if (storeId) this.locationCache.delete(storeId);
    else this.locationCache.clear();
  }

  private async variantNode(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): Promise<Record<string, unknown>> {
    const body = await this.rest<{ product?: { variants?: any[] } }>(
      store,
      'GET',
      `/products/${encodeURIComponent(parentRef.providerId)}.json?fields=id,variants`,
    );
    const variants = (body.product?.variants ?? []) as any[];
    const hit = variants.find((v: any) => String(v?.id) === String(variantRef.providerId));
    if (!hit) {
      throw new ProviderError(
        `[shopify] unknown variant ${variantRef.providerId} of ${parentRef.providerId}`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        'shopify',
      );
    }
    return hit as Record<string, unknown>;
  }

  /**
   * Ensure the variant is tracked (`inventory_management: 'shopify'`).
   * Set on push when absent — untracked variants ignore InventoryLevel, so
   * without this the projection would silently not apply. Deny policy:
   * tracked inventory with `inventory_policy: 'deny'` stops selling at 0
   * (the 0-band guarantee); the policy travels on the same update when the
   * remote accepts it, and is best-effort otherwise (the quantity itself is
   * the enforcement — a 0 available sells nothing regardless).
   */
  private async ensureTracked(
    store: StoreWithSecrets,
    variantId: string,
    inventoryItemId: string,
  ): Promise<void> {
    await this.rest(store, 'PUT', `/variants/${encodeURIComponent(variantId)}.json`, {
      variant: { id: variantId, inventory_management: 'shopify', inventory_policy: 'deny' },
    }).catch(() => null);
    // Inventory-item tracking flag (older stores gate levels on it).
    await this.rest(store, 'PUT', `/inventory_items/${encodeURIComponent(inventoryItemId)}.json`, {
      inventory_item: { id: inventoryItemId, tracked: true },
    }).catch(() => null);
  }

  /**
   * P13 capped quantity push. The engine passes the already-banded wire
   * qty (cap for the above band, exact units for 1–5, 0 for zero) — the
   * adapter writes exactly what it is given via `InventoryLevel.set`
   * (`available`, disconnect-if-necessary semantics), never the ERP truth
   * above the cap. One bounded product read stages the variant's
   * `inventory_item_id`; tracked + deny are ensured on every push (cheap,
   * idempotent, and required for the 0-band no-sell guarantee).
   */
  async publishStockQuantity(
    store: StoreWithSecrets,
    ref: RemoteRef,
    qty: number,
  ): Promise<PushResult> {
    const n = Math.max(0, Math.floor(qty));
    const locationId = await this.resolveLocationId(store);
    const body = await this.rest<{ product?: { variants?: any[] } }>(
      store,
      'GET',
      `/products/${encodeURIComponent(ref.providerId)}.json?fields=id,variants`,
    );
    const variants = (body.product?.variants ?? []) as any[];
    if (variants.length === 0) {
      throw new ProviderError(
        `[shopify] SHOPIFY_NO_VARIANTS: product ${ref.providerId} exposes no variants to project stock onto`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        'shopify',
      );
    }
    // Simple products project onto their single (default) variant; variable
    // products are projected per-variant via publishVariantStockQuantity —
    // a product-level call spreads nothing, it targets the default variant.
    const target = variants[0] as any;
    await this.setLevel(store, locationId, String(target.id), String(target.inventory_item_id), n);
    return { ok: true, ref };
  }

  async publishVariantStockQuantity(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
    qty: number,
  ): Promise<PushResult> {
    const n = Math.max(0, Math.floor(qty));
    const locationId = await this.resolveLocationId(store);
    const node = await this.variantNode(store, parentRef, variantRef);
    await this.setLevel(
      store,
      locationId,
      String((node as any).id ?? variantRef.providerId),
      String((node as any).inventory_item_id ?? ''),
      n,
    );
    return { ok: true, ref: variantRef };
  }

  private async setLevel(
    store: StoreWithSecrets,
    locationId: string,
    variantId: string,
    inventoryItemId: string,
    qty: number,
  ): Promise<void> {
    if (!inventoryItemId) {
      throw new ProviderError(
        `[shopify] SHOPIFY_NO_INVENTORY_ITEM: variant ${variantId} exposes no inventory_item_id`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        'shopify',
      );
    }
    await this.ensureTracked(store, variantId, inventoryItemId);
    await this.rest(store, 'POST', '/inventory_levels/set.json', {
      location_id: locationId,
      inventory_item_id: inventoryItemId,
      available: qty,
    });
  }

  // NOTE: publishStockState / publishVariantStockState are INTENTIONALLY
  // inherited from BaseCommerceProvider (P13): the engine never calls them
  // on a `quantized-capped` provider — quantity projection owns every band
  // (status is derived from the level, not pushed alongside it).

  // ── Orders: paged fetch, CANCELLED/FULFILLED push, read-back ──────────

  override async fetchOrders(
    store: StoreWithSecrets,
    opts: { since: Date; until: Date; status?: string[]; page: number; pageSize: number; cursor?: string },
  ): Promise<{ orders: NormalizedOrder[]; hasMore: boolean; nextCursor?: string }> {
    // Cursor pagination (RFC5988 Link header): the `page` param was removed
    // by the platform (422 "page cannot be passed"). First page carries the
    // window; follow-ups carry ONLY limit + page_info.
    const params = new URLSearchParams({
      limit: String(Math.min(Math.max(opts.pageSize, 1), 250)),
    });
    if (opts.cursor) {
      params.set('page_info', opts.cursor);
    } else {
      params.set('status', 'any');
      params.set('created_at_min', opts.since.toISOString());
      params.set('created_at_max', opts.until.toISOString());
      params.set(
        'fields',
        'id,name,financial_status,fulfillment_status,cancelled_at,cancel_reason,total_price,currency,created_at,updated_at,line_items,customer,phone,email',
      );
      if (opts.status && opts.status.length > 0) params.set('financial_status', opts.status.join(','));
    }
    const { data, link } = await this.getWithHeaders<{ orders?: unknown[] }>(
      store,
      `/orders.json?${params.toString()}`,
    );
    const orders = (data.orders ?? []) as NormalizedOrder[];
    const nextCursor = this.nextPageInfo(link);
    return {
      orders,
      hasMore: nextCursor !== null,
      ...(nextCursor ? { nextCursor } : {}),
    };
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
    const registered: string[] = [...have].filter((t) => SHOPIFY_WEBHOOK_TOPICS.includes(t));
    const skipped: string[] = [];
    for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
      if (have.has(topic)) continue;
      try {
        await this.rest(store, 'POST', '/webhooks.json', {
          webhook: {
            topic,
            address: `${callbackBaseUrl.replace(/\/+$/, '')}/api/webhooks/stores/shopify/${store.id}`,
            format: 'json',
            // NOTE: api_version is intentionally NOT sent — the API rejects
            // it (422). Payload version comes from the app's "Webhooks API
            // version" dashboard setting, which must match
            // SHOPIFY_API_VERSION (currently 2026-07).
          },
        });
        registered.push(topic);
      } catch (err) {
        // Order topics carry protected customer data: without dashboard
        // approval Shopify 403s the subscription. Skip the topic with a
        // reason (reconcile still covers ingestion) instead of failing the
        // whole registration. Any other error still throws.
        const msg = String((err as any)?.message ?? '');
        if (/protected customer data|protected_data/i.test(msg)) {
          skipped.push(topic);
          continue;
        }
        throw err;
      }
    }
    if (registered.length === 0) {
      return {
        ok: false,
        topics: [],
        reason: `no topics registered (skipped: ${skipped.join(', ') || 'none'} — protected customer data approval required)`,
      };
    }
    return {
      ok: true,
      topics: registered,
      ...(skipped.length > 0
        ? { reason: `skipped: ${skipped.join(', ')} — protected customer data approval required; order ingestion continues via reconcile` }
        : {}),
    };
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

/**
 * True when at least one variant carries real attribute entries. The
 * 'Title' fallback above exists so multi-variant creates satisfy Shopify's
 * options requirement — but with empty values Shopify rejects the push
 * ("options must have corresponding variants"). Attribute-less variant
 * sets must omit `options` entirely (Shopify auto-creates Default Title).
 */
function variantsHaveAttributes(variants: Record<string, unknown>[]): boolean {
  return variants.some((v) => {
    const attrs =
      (v as any).attributes ?? (v as any).variantAttributes;
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
      return Object.keys(attrs).length > 0;
    }
    if (Array.isArray(attrs)) {
      return attrs.some(
        (a: any) =>
          (a?.attrs && Object.keys(a.attrs).length > 0) ||
          (a?.values && a.values.length > 0),
      );
    }
    return false;
  });
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
