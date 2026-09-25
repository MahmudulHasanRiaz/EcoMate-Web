/**
 * Custom bridge adapter — central-commerce P10 (Bridge v1, §7.1 Custom column).
 *
 * Full implementation against `docs/central-commerce/BRIDGE-V1-PROTOCOL.md`:
 * manifest discovery (`GET {endpoint}/.well-known/ecomate-bridge`),
 * bearer auth, products/variants/media/categories/publication/delete,
 * status-only stock (faithful push vs unsupported zero-write monitor),
 * order pull, status push + read-back, webhook registration + HMAC verify.
 *
 * Capability model: `declaredCapabilities` are the safe defaults (locked by
 * the contract suite — `stockStatusFidelity: 'faithful'`, status-only
 * recommended). `resolveCapabilities()` overlays the live manifest, which
 * may only NARROW (except `costPrice`, which the manifest may enable —
 * still push-only, BR-23; `combos` is forced false always, BR-22).
 * Unsupported entries are capability-gated skips with an explicit reason,
 * never silent. Core services are untouched — they branch on capabilities
 * (P10 acceptance: no core-service change was needed).
 *
 * Never called from a mutation: adapter methods run only in queued workers
 * (R-2/BR-21). Missing connection settings throw INVALID_REQUEST before
 * any HTTP call (never an unauthed call). No quantity, sentinel or
 * placeholder value is ever written (BR-06); cost is never customer-facing
 * (BR-23); combos are never fabricated (BR-22).
 */
import { Injectable } from '@nestjs/common';
import {
  ProviderError,
  ProviderErrorCategory,
} from '../../marketing/ad-provider.adapter';
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
  signCustomDelivery,
} from './webhook-crypto';
import { snapshotField } from './field-snapshot';
import { classifyHttpStatus } from './retry-classifier';
import { isAllowedCustomField } from '../sync/field-matrix';

/** Bridge protocol version pinned for phase 1. */
export const BRIDGE_API_VERSION = '1.0';

/** Manifest discovery path (protocol §1). */
export const BRIDGE_MANIFEST_PATH = '/.well-known/ecomate-bridge';

/** Webhook topics provisioned by ensureWebhooks (protocol §6). */
export const BRIDGE_WEBHOOK_TOPICS = [
  'order.created',
  'order.updated',
  'product.updated',
];

/** Canonical order-status vocabulary (protocol §7; manifest intersects). */
export const BRIDGE_STATUS_TARGETS = ['cancelled', 'completed'] as const;

interface BridgeContext {
  baseUrl: string;
  bridgeKey: string;
}

function ctxOf(store: StoreWithSecrets): BridgeContext {
  const secrets = store.secrets ?? {};
  const settings = store.settings ?? {};
  const baseUrl = String(secrets.baseUrl ?? settings.baseUrl ?? '').replace(
    /\/+$/,
    '',
  );
  const bridgeKey = String(secrets.bridgeKey ?? '');
  if (!baseUrl || !bridgeKey) {
    throw new ProviderError(
      '[custom] missing connection settings (baseUrl/bridgeKey)',
      ProviderErrorCategory.INVALID_REQUEST,
      'custom',
    );
  }
  return { baseUrl, bridgeKey };
}

function toProviderError(
  status: number,
  body: unknown,
  path: string,
): ProviderError {
  const decision = classifyHttpStatus(status);
  return new ProviderError(
    `[custom] ${path} → http-${status}: ${JSON.stringify(body ?? null).slice(0, 300)}`,
    decision.category,
    'custom',
  );
}

function invalidManifest(reason: string): ProviderError {
  return new ProviderError(
    `[custom] invalid bridge manifest: ${reason}`,
    ProviderErrorCategory.INVALID_REQUEST,
    'custom',
  );
}

/** Raw manifest document (protocol §1). Unknown keys are ignored. */
export interface BridgeManifest {
  bridge?: unknown;
  storeId?: unknown;
  displayName?: unknown;
  capabilities?: Record<string, unknown>;
  categoryModel?: unknown;
  seoModel?: unknown;
  mediaModel?: unknown;
  webhookTopics?: unknown;
  mediaProbeUrl?: unknown;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Manifest → effective capabilities. Starts from the declared safe
 * defaults; the manifest may only NARROW (true→false), except `costPrice`
 * which it may enable (push-only, BR-23). `combos` is forced false even
 * when the manifest claims true (BR-22). Targets are intersected with the
 * canonical vocabulary. Invalid enum values fall back to declared.
 */
export function bridgeManifestToCapabilities(
  manifest: BridgeManifest,
  declared: ProviderCapabilities,
): ProviderCapabilities {
  const mc = manifest.capabilities ?? {};
  const narrow = (key: keyof ProviderCapabilities): boolean => {
    const v = asBool(mc[String(key)]);
    // Narrow-only: an explicit `false` disables; anything else keeps declared.
    if (v === false) return false;
    return Boolean(declared[key]);
  };
  const rawTargets = Array.isArray(mc.orderStatusUpdateTargets)
    ? (mc.orderStatusUpdateTargets as unknown[]).map((t) => String(t))
    : [...declared.orderStatusUpdateTargets];
  const targets = rawTargets.filter((t) =>
    (BRIDGE_STATUS_TARGETS as readonly string[]).includes(t),
  );
  const fidelity =
    mc.stockStatusFidelity === 'faithful' ||
    mc.stockStatusFidelity === 'unsupported'
      ? mc.stockStatusFidelity
      : declared.stockStatusFidelity;
  const categoryModel =
    mc.categoryModel === undefined && manifest.categoryModel !== undefined
      ? manifest.categoryModel
      : (mc as Record<string, unknown>).categoryModel;
  const validCategory =
    categoryModel === 'custom' || categoryModel === 'unsupported'
      ? categoryModel
      : declared.categoryModel;
  const seoModel =
    manifest.seoModel === 'native' || manifest.seoModel === 'unsupported'
      ? manifest.seoModel
      : declared.seoModel;
  const mediaModel =
    manifest.mediaModel === 'url-fetch' ||
    manifest.mediaModel === 'binary-upload' ||
    manifest.mediaModel === 'unsupported'
      ? manifest.mediaModel
      : declared.mediaModel;
  return {
    products: narrow('products'),
    variations: narrow('variations'),
    variantDelete:
      asBool(mc.variantDelete) === false ? false : declared.variantDelete,
    categories: narrow('categories'),
    media: narrow('media'),
    mediaReuse:
      asBool(mc.mediaReuse) === false ? false : declared.mediaReuse,
    delete: narrow('delete'),
    seo: narrow('seo'),
    // The one flag a manifest may enable (still push-only, BR-23).
    costPrice:
      asBool(mc.costPrice) === true ? true : declared.costPrice,
    weight: narrow('weight'),
    dimensions: narrow('dimensions'),
    slug: narrow('slug'),
    orders: narrow('orders'),
    webhooks: narrow('webhooks'),
    orderStatusUpdate: narrow('orderStatusUpdate'),
    orderStatusUpdateTargets: targets,
    stockStatusFidelity: fidelity,
    contactCheckExposure:
      asBool(mc.contactCheckExposure) === false
        ? false
        : declared.contactCheckExposure,
    categoryModel: validCategory,
    seoModel,
    mediaModel,
    combos: false, // BR-22: forced, even when the manifest claims true.
    externalEditsDetectable: declared.externalEditsDetectable,
  };
}

/**
 * Normalized EcoMate fields → bridge product payload (protocol §3).
 * Only manifest-enabled fields are rendered (capability-gated, never
 * silent — the caller resolves capabilities first). NEVER includes:
 * quantities (BR-06), secrets (customFields are allowlisted before this
 * point), cost unless `costPrice` was manifest-enabled (BR-23 push-only).
 */
export function bridgeFieldToPayload(
  input: Record<string, unknown>,
  caps: ProviderCapabilities,
): Record<string, unknown> {
  if (input.productType !== undefined && String(input.productType) === 'combo') {
    throw new ProviderError(
      '[custom] COMBO_SKIPPED: combos are not representable by phase-1 providers (BR-22)',
      ProviderErrorCategory.INVALID_REQUEST,
      'custom',
    );
  }
  const out: Record<string, unknown> = {};
  if (caps.products) {
    if (input.name !== undefined) out.name = input.name;
    if (input.shortDescription !== undefined)
      out.short_description = input.shortDescription;
    if (input.fullDescription !== undefined)
      out.description = input.fullDescription;
    if (input.sku !== undefined) out.sku = input.sku;
    if (input.price !== undefined) out.price = input.price;
    if (input.salePrice !== undefined) out.sale_price = input.salePrice;
    if (input.brand !== undefined && input.brand !== null)
      out.brand = String(input.brand);
    if (input.tags !== undefined) {
      const tags = Array.isArray(input.tags) ? input.tags : [input.tags];
      out.tags = tags.map((t) =>
        typeof t === 'string' ? t : String((t as any)?.name ?? t ?? ''),
      );
    }
    if (input.publicationState !== undefined) {
      out.status =
        input.publicationState === 'published' ? 'published' : 'draft';
    }
    if (
      input.customFields !== undefined &&
      input.customFields !== null &&
      typeof input.customFields === 'object'
    ) {
      const allowed = Object.entries(
        input.customFields as Record<string, unknown>,
      ).filter(([k]) => isAllowedCustomField(k));
      if (allowed.length > 0) out.custom_fields = Object.fromEntries(allowed);
    }
    if (caps.costPrice && input.costPrice !== undefined && input.costPrice !== null) {
      out.cost_price = input.costPrice;
    }
  }
  if (caps.slug && input.slug !== undefined) out.slug = input.slug;
  if (caps.weight && input.weight !== undefined) out.weight = input.weight;
  if (
    caps.dimensions &&
    input.dimensions !== undefined &&
    input.dimensions !== null &&
    typeof input.dimensions === 'object'
  ) {
    const d = input.dimensions as Record<string, unknown>;
    out.dimensions = {
      length: d.length ?? null,
      width: d.width ?? null,
      height: d.height ?? null,
    };
  }
  if (caps.categories && input.category !== undefined && input.category !== null) {
    const ids = Array.isArray(input.category) ? input.category : [input.category];
    out.category_ids = ids.map((id) => String(id));
  }
  if (caps.media) {
    const images: { src: string }[] = [];
    if (input.primaryImage) images.push({ src: String(input.primaryImage) });
    if (Array.isArray(input.galleryImages)) {
      for (const src of input.galleryImages as unknown[]) {
        if (src) images.push({ src: String(src) });
      }
    }
    if (images.length > 0) out.images = images;
  }
  if (caps.seo) {
    if (input.seoTitle !== undefined) out.seo_title = input.seoTitle;
    if (input.seoDescription !== undefined)
      out.seo_description = input.seoDescription;
  }
  return out;
}

/** Single-variant payload (price pair + identifiers). */
export function bridgeVariantToPayload(
  v: Record<string, unknown>,
): Record<string, unknown> {
  if (v.productType !== undefined && String(v.productType) === 'combo') {
    throw new ProviderError(
      '[custom] COMBO_SKIPPED: combos are not representable by phase-1 providers (BR-22)',
      ProviderErrorCategory.INVALID_REQUEST,
      'custom',
    );
  }
  const out: Record<string, unknown> = {};
  if (v.sku !== undefined) out.sku = v.sku;
  if (v.name !== undefined) out.name = v.name;
  if (v.price !== undefined) out.price = v.price;
  if (v.salePrice !== undefined) out.sale_price = v.salePrice;
  if (v.barcode !== undefined) out.barcode = v.barcode;
  if (v.weight !== undefined) out.weight = v.weight;
  if (v.attributes !== undefined) out.attributes = v.attributes;
  return out;
}

/**
 * Bridge product JSON → §8.11 field snapshots (ownership baselines).
 * `cost_price` is NEVER read back (push-only, BR-23 → snapshot null).
 */
export function bridgeProductToSnapshots(
  body: Record<string, unknown>,
  fields: FieldKey[],
): Record<FieldKey, FieldSnapshot> {
  const variants = (Array.isArray(body.variants) ? body.variants : []) as Record<
    string,
    unknown
  >[];
  const images = (Array.isArray(body.images) ? body.images : []) as {
    src?: string;
  }[];
  const first = variants[0] ?? {};
  const derived: Record<string, unknown> = {
    name: body.name ?? null,
    shortDescription: body.short_description ?? null,
    fullDescription: body.description ?? null,
    sku: body.sku ?? first.sku ?? null,
    productCode: body.sku ?? first.sku ?? null,
    barcode: (body as any).barcode ?? first.sku ?? null,
    primaryImage: images[0]?.src ?? null,
    galleryImages: images
      .slice(1)
      .map((i) => i.src)
      .filter(Boolean),
    category: body.category_ids ?? null,
    brand: body.brand ?? null,
    tags: Array.isArray(body.tags)
      ? (body.tags as unknown[]).map((t) =>
          typeof t === 'string' ? t : String((t as any)?.name ?? t),
        )
      : [],
    productType: variants.length > 0 ? 'variable' : 'simple',
    variants: variants.map((v) => ({ sku: v.sku ?? null, price: v.price ?? null })),
    variantAttributes: [],
    price: body.price ?? first.price ?? null,
    salePrice: body.sale_price ?? null,
    costPrice: null, // push-only (BR-23); never read back as truth.
    weight: body.weight ?? null,
    dimensions: body.dimensions ?? null,
    seoTitle: body.seo_title ?? null,
    seoDescription: body.seo_description ?? null,
    slug: body.slug ?? null,
    publicationState:
      body.status === 'published' ? 'published' : 'draft',
    customFields: (() => {
      const out: Record<string, unknown> = {};
      const cf =
        body.custom_fields !== null &&
        typeof body.custom_fields === 'object' &&
        !Array.isArray(body.custom_fields)
          ? (body.custom_fields as Record<string, unknown>)
          : {};
      for (const [k, v] of Object.entries(cf)) {
        if (isAllowedCustomField(k)) out[k] = v;
      }
      return out;
    })(),
  };
  const out: Record<FieldKey, FieldSnapshot> = {};
  for (const f of fields) out[f] = snapshotField(derived[f]);
  return out;
}

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
    combos: false, // BR-22; forced false even when a manifest claims true
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

  // ── HTTP seam (bearer bridge key) ────────────────────────────────────

  private async bridge<T>(
    store: StoreWithSecrets,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const ctx = ctxOf(store);
    const res = await this.fetchFn(`${ctx.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${ctx.bridgeKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) throw toProviderError(res.status, parsed, `${method} ${path}`);
    return parsed as T;
  }

  /** Fetch + validate the manifest (protocol §1). Throws on any failure. */
  private async fetchManifest(store: StoreWithSecrets): Promise<BridgeManifest> {
    const ctx = ctxOf(store);
    let res;
    try {
      res = await this.fetchFn(`${ctx.baseUrl}${BRIDGE_MANIFEST_PATH}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ctx.bridgeKey}` },
      });
    } catch (err) {
      throw new ProviderError(
        `[custom] manifest request failed: ${err instanceof Error ? err.message : String(err)}`,
        ProviderErrorCategory.TEMPORARY_FAILURE,
        'custom',
        err,
      );
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) throw toProviderError(res.status, body, 'GET manifest');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw invalidManifest('expected a JSON object');
    }
    const manifest = body as BridgeManifest;
    if (
      manifest.storeId === undefined ||
      manifest.storeId === null ||
      String(manifest.storeId).trim().length === 0
    ) {
      throw invalidManifest('missing required `storeId`');
    }
    if (
      manifest.capabilities !== undefined &&
      (typeof manifest.capabilities !== 'object' ||
        manifest.capabilities === null ||
        Array.isArray(manifest.capabilities))
    ) {
      throw invalidManifest('`capabilities` must be an object when present');
    }
    return manifest;
  }

  /** Manifest-discovered capabilities; safe declared defaults on failure. */
  override async resolveCapabilities(
    store: StoreWithSecrets,
  ): Promise<ProviderCapabilities> {
    try {
      const manifest = await this.fetchManifest(store);
      return bridgeManifestToCapabilities(manifest, this.declaredCapabilities);
    } catch {
      return this.declaredCapabilities;
    }
  }

  // ── testConnection (reachability, auth, manifest, media preflight) ───

  /**
   * Probe `GET {endpoint}/.well-known/ecomate-bridge` (bearer bridge key).
   * providerStoreId comes from the bridge `storeId` (§8.10 duplicate
   * protection); capabilities are the manifest-resolved set so the wizard
   * renders the real stock-fidelity + contact-check summary.
   */
  override async testConnection(
    store: StoreWithSecrets,
  ): Promise<TestConnectionResult> {
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
    const probed = await this.tryProbe(`${baseUrl}${BRIDGE_MANIFEST_PATH}`, {
      headers: { Authorization: `Bearer ${String(secrets.bridgeKey)}` },
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
    if (status === 200) {
      try {
        const manifest = body as BridgeManifest;
        if (
          !manifest ||
          typeof manifest !== 'object' ||
          manifest.storeId === undefined ||
          manifest.storeId === null ||
          String(manifest.storeId).trim().length === 0
        ) {
          throw invalidManifest('missing required `storeId`');
        }
        const caps = bridgeManifestToCapabilities(
          manifest,
          this.declaredCapabilities,
        );
        const probeUrl =
          typeof manifest.mediaProbeUrl === 'string' &&
          manifest.mediaProbeUrl.length > 0
            ? manifest.mediaProbeUrl
            : (settings as Record<string, unknown>).mediaProbeUrl;
        return {
          reachable: true,
          authenticated: true,
          permissionsOk: true,
          mediaReachable: await this.mediaPreflight(probeUrl),
          providerStoreId: String(manifest.storeId),
          capabilities: caps,
        };
      } catch {
        // Speaks HTTP but not Bridge v1 — reachable + authed, not permitted.
        return {
          reachable: true,
          authenticated: true,
          permissionsOk: false,
          capabilities: this.declaredCapabilities,
        };
      }
    }
    return this.connectionFromProbe(
      status,
      body,
      undefined,
      this.declaredCapabilities,
    );
  }

  /** Media preflight (plan §12): HEAD the probe URL when set. */
  private async mediaPreflight(
    probeUrl: unknown,
  ): Promise<boolean | undefined> {
    if (typeof probeUrl !== 'string' || probeUrl.length === 0)
      return undefined;
    try {
      const res = await this.fetchFn(probeUrl, { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * `X-EcoMate-Signature` (hex HMAC over
   * `deliveryId.timestamp.rawBody`) + `X-EcoMate-Delivery-Id` +
   * `X-EcoMate-Timestamp` inside the 5-minute replay window (§8.7,
   * protocol §2).
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
    return {
      valid: true,
      deliveryId,
      topic: getHeader(headers, 'X-EcoMate-Topic'),
    };
  }

  // ── Categories (bridge-native hierarchy, mapping keyed on ids) ───────

  /**
   * Resolve each path level-by-level: local mapping is core-owned; here
   * lookup by slug within parent precedes create (duplicate prevention,
   * §8.9). `categories: false` in the manifest → loud
   * CAPABILITY_UNSUPPORTED (core raises CATEGORY_UNSUPPORTED and product
   * sync proceeds — never silent).
   */
  override async ensureCategories(
    store: StoreWithSecrets,
    paths: CategoryPath[],
  ): Promise<Map<string, RemoteRef>> {
    const caps = await this.resolveCapabilities(store);
    if (!caps.categories) {
      throw new ProviderError(
        '[custom] CAPABILITY_UNSUPPORTED: bridge manifest disables categories (§8.9: notice + product sync proceeds)',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    const out = new Map<string, RemoteRef>();
    for (const path of paths) {
      let parentId: string | null = null;
      let leaf: RemoteRef | null = null;
      for (const level of path) {
        const slug = bridgeSlugify(String(level));
        const params = new URLSearchParams({ slug, limit: '1' });
        if (parentId) params.set('parent', parentId);
        const found = await this.bridge<{ categories?: any[] }>(
          store,
          'GET',
          `/bridge/v1/categories?${params.toString()}`,
        );
        const match = (found.categories ?? []).find(
          (c: any) => String(c.slug) === slug,
        );
        if (match) {
          parentId = String(match.id);
          leaf = { providerId: parentId };
          continue;
        }
        const created = await this.bridge<{ category?: any }>(
          store,
          'POST',
          '/bridge/v1/categories',
          { name: String(level), slug, parent_id: parentId },
        );
        parentId = String(created.category.id);
        leaf = { providerId: parentId };
      }
      if (leaf) out.set(path.join(' / '), leaf);
    }
    return out;
  }

  override async renameCategory(
    store: StoreWithSecrets,
    ref: RemoteRef,
    next: CategoryInput,
  ): Promise<PushResult> {
    const updated = await this.bridge<{ category?: any }>(
      store,
      'PUT',
      `/bridge/v1/categories/${encodeURIComponent(ref.providerId)}`,
      { name: next.name, slug: next.slug },
    );
    return { ok: true, ref: { providerId: String(updated.category.id) } };
  }

  override async moveCategory(
    store: StoreWithSecrets,
    ref: RemoteRef,
    parent: RemoteRef | null,
  ): Promise<PushResult> {
    try {
      await this.bridge(
        store,
        'PUT',
        `/bridge/v1/categories/${encodeURIComponent(ref.providerId)}`,
        { parent_id: parent ? parent.providerId : null },
      );
      return { ok: true, ref };
    } catch (err) {
      // A bridge that cannot re-parent answers 422 capability_unsupported:
      // loud skip (never a duplicate, never silence) — core raises an
      // actionable issue (§8.9).
      if (
        err instanceof ProviderError &&
        err.category === ProviderErrorCategory.INVALID_REQUEST &&
        /capability_unsupported/i.test(err.message)
      ) {
        return {
          ok: true,
          skipped: true,
          ref,
          reason:
            'CATEGORY_MOVE_UNSUPPORTED: bridge cannot re-parent — membership unchanged',
        };
      }
      throw err;
    }
  }

  /** First-contact lookup by SKU (BR-05 adopt_existing probe). */
  async findBySku(
    store: StoreWithSecrets,
    sku: string,
  ): Promise<RemoteRef | null> {
    const params = new URLSearchParams({ sku, limit: '1' });
    const list = await this.bridge<{ products?: any[] }>(
      store,
      'GET',
      `/bridge/v1/products?${params.toString()}`,
    );
    const first = (list.products ?? [])[0];
    return first ? { providerId: String(first.id) } : null;
  }

  // ── Products / variants / media / publication / delete ──────────────

  override async readProductFields(
    store: StoreWithSecrets,
    ref: RemoteRef,
    fields: FieldKey[],
  ): Promise<Record<FieldKey, FieldSnapshot>> {
    const body = await this.bridge<{ product?: Record<string, unknown> }>(
      store,
      'GET',
      `/bridge/v1/products/${encodeURIComponent(ref.providerId)}`,
    );
    return bridgeProductToSnapshots(
      { ...((body.product ?? {}) as Record<string, unknown>) },
      fields,
    );
  }

  override async upsertProduct(
    store: StoreWithSecrets,
    input: NormalizedProduct,
    fields: FieldKey[],
  ): Promise<RemoteRef> {
    const rec = { ...(input as Record<string, unknown>) };
    if (
      rec.sku === undefined ||
      rec.sku === null ||
      String(rec.sku).trim().length === 0
    ) {
      throw new ProviderError(
        '[custom] MISSING_SKU: a product without an SKU cannot be distributed',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    const caps = await this.resolveCapabilities(store);
    if (!caps.products) {
      throw new ProviderError(
        '[custom] CAPABILITY_UNSUPPORTED: bridge manifest disables products',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    const payload = bridgeFieldToPayload(rec, caps);
    const externalId =
      typeof rec.__externalId === 'string' ? rec.__externalId : undefined;
    // Field-scoped upsert: only the requested fields travel (Table B —
    // "push the changed field only"). `price`/`salePrice` travel together
    // because the bridge stores them as one pair.
    const scoped = scopePayload(payload, fields);
    if (externalId) {
      const updated = await this.bridge<{ product?: any }>(
        store,
        'PUT',
        `/bridge/v1/products/${encodeURIComponent(externalId)}`,
        scoped,
      );
      return { providerId: String(updated.product?.id ?? externalId) };
    }
    // Idempotent create: SKU match first (same sku → same ref).
    const existing = await this.findBySku(store, String(rec.sku)).catch(
      () => null,
    );
    if (existing) {
      const updated = await this.bridge<{ product?: any }>(
        store,
        'PUT',
        `/bridge/v1/products/${encodeURIComponent(existing.providerId)}`,
        scoped,
      );
      return {
        providerId: String(updated.product?.id ?? existing.providerId),
      };
    }
    const created = await this.bridge<{ product?: any }>(
      store,
      'POST',
      '/bridge/v1/products',
      payload,
    );
    return { providerId: String(created.product.id) };
  }

  override async upsertVariants(
    store: StoreWithSecrets,
    ref: RemoteRef,
    variants: NormalizedVariant[],
  ): Promise<Map<string, RemoteRef>> {
    const caps = await this.resolveCapabilities(store);
    if (!caps.variations) {
      throw new ProviderError(
        '[custom] CAPABILITY_UNSUPPORTED: bridge manifest disables variations',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    const out = new Map<string, RemoteRef>();
    const remote = await this.bridge<{ variants?: any[] }>(
      store,
      'GET',
      `/bridge/v1/products/${encodeURIComponent(ref.providerId)}/variants?limit=250`,
    ).catch(() => ({ variants: [] as any[] }));
    const bySku = new Map(
      (remote.variants ?? []).map((v: any) => [String(v.sku ?? ''), v]),
    );
    for (const v of variants) {
      const rec = { ...(v as Record<string, unknown>) };
      const sku = String(rec.sku ?? '');
      if (!sku) {
        throw new ProviderError(
          '[custom] MISSING_SKU: a variant without an SKU cannot be distributed',
          ProviderErrorCategory.INVALID_REQUEST,
          'custom',
        );
      }
      const payload = bridgeVariantToPayload(rec);
      const existingId =
        typeof rec.__externalVariantId === 'string'
          ? rec.__externalVariantId
          : undefined;
      const match = existingId ? { id: existingId } : bySku.get(sku);
      if (match?.id !== undefined) {
        const updated = await this.bridge<{ variant?: any }>(
          store,
          'PUT',
          `/bridge/v1/variants/${encodeURIComponent(String(match.id))}`,
          payload,
        );
        out.set(sku, { providerId: String(updated.variant?.id ?? match.id) });
        continue;
      }
      const created = await this.bridge<{ variant?: any }>(
        store,
        'POST',
        `/bridge/v1/products/${encodeURIComponent(ref.providerId)}/variants`,
        payload,
      );
      out.set(sku, { providerId: String(created.variant.id) });
    }
    return out;
  }

  override async ensureMedia(
    store: StoreWithSecrets,
    items: NormalizedMedia[],
  ): Promise<Map<string, RemoteRef>> {
    const caps = await this.resolveCapabilities(store);
    if (!caps.media) {
      throw new ProviderError(
        '[custom] CAPABILITY_UNSUPPORTED: bridge manifest disables media (products sync imageless)',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    // url-fetch with hash reuse: lookup by content hash first — mapped media
    // is never re-uploaded (Table B rows 7–8).
    const out = new Map<string, RemoteRef>();
    for (const item of items) {
      const rec = item as unknown as { src: string; hash: string };
      if (caps.mediaReuse && rec.hash) {
        const found = await this.bridge<{ media?: any[] }>(
          store,
          'GET',
          `/bridge/v1/media?hash=${encodeURIComponent(rec.hash)}`,
        ).catch(() => ({ media: [] as any[] }));
        const hit = (found.media ?? [])[0];
        if (hit) {
          out.set(rec.src, { providerId: String(hit.id) });
          continue;
        }
      }
      const created = await this.bridge<{ media?: any }>(
        store,
        'POST',
        '/bridge/v1/media',
        { src: rec.src, ...(rec.hash ? { hash: rec.hash } : {}) },
      );
      out.set(rec.src, { providerId: String(created.media.id) });
    }
    return out;
  }

  override async setPublication(
    store: StoreWithSecrets,
    ref: RemoteRef,
    state: 'published' | 'draft',
  ): Promise<PushResult> {
    await this.bridge(
      store,
      'POST',
      `/bridge/v1/products/${encodeURIComponent(ref.providerId)}/publication`,
      { state },
    );
    return { ok: true, ref };
  }

  /**
   * Capability-gated deletion (BR-09: hard-delete path only). Manifest
   * `delete: false` → loud CAPABILITY_UNSUPPORTED (core raises
   * MANUAL_ACTION_REQUIRED); unpublish and assignment-OFF never reach here.
   */
  override async deleteProduct(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<PushResult> {
    const caps = await this.resolveCapabilities(store);
    if (!caps.delete) {
      throw new ProviderError(
        '[custom] CAPABILITY_UNSUPPORTED: bridge manifest disables delete (BR-09: retained + MANUAL_ACTION_REQUIRED)',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    await this.bridge(
      store,
      'DELETE',
      `/bridge/v1/products/${encodeURIComponent(ref.providerId)}`,
    );
    return { ok: true };
  }

  // ── Stock: status-only push vs zero-write monitor (BR-06/BR-08) ──────

  /**
   * Read-only stock state for the drift audit: `GET …/stock` → IN/OUT.
   * Zero writes by construction.
   */
  override async readStockState(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<StockState> {
    const body = await this.bridge<{ status?: unknown }>(
      store,
      'GET',
      `/bridge/v1/products/${encodeURIComponent(ref.providerId)}/stock`,
    );
    return String(body.status ?? '').toLowerCase() === 'in_stock'
      ? 'IN_STOCK'
      : 'OUT_OF_STOCK';
  }

  override async readVariantStockState(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): Promise<StockState> {
    const body = await this.bridge<{ status?: unknown }>(
      store,
      'GET',
      `/bridge/v1/products/${encodeURIComponent(parentRef.providerId)}/variants/${encodeURIComponent(variantRef.providerId)}/stock`,
    );
    return String(body.status ?? '').toLowerCase() === 'in_stock'
      ? 'IN_STOCK'
      : 'OUT_OF_STOCK';
  }

  /**
   * Status-only push (BR-06): the PUT body carries ONLY `{status}` — no
   * quantity field exists in this protocol. When the manifest declares
   * `unsupported`, throws BEFORE any HTTP write beyond the manifest GET
   * (zero writes, monitor-only like Shopify — BR-08). A manifest outage
   * fails closed (throw, retryable) rather than writing blind.
   */
  override async publishStockState(
    store: StoreWithSecrets,
    ref: RemoteRef,
    state: StockState,
  ): Promise<PushResult> {
    const caps = await this.manifestCapabilitiesOrThrow(store);
    if (caps.stockStatusFidelity === 'unsupported') {
      throw new ProviderError(
        '[custom] stock writes are unsupported (BR-08: monitor-only, zero writes)',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    await this.bridge(
      store,
      'PUT',
      `/bridge/v1/products/${encodeURIComponent(ref.providerId)}/stock`,
      { status: state === 'IN_STOCK' ? 'in_stock' : 'out_of_stock' },
    );
    return { ok: true, ref };
  }

  override async publishVariantStockState(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
    state: StockState,
  ): Promise<PushResult> {
    const caps = await this.manifestCapabilitiesOrThrow(store);
    if (caps.stockStatusFidelity === 'unsupported') {
      throw new ProviderError(
        '[custom] stock writes are unsupported (BR-08: monitor-only, zero writes)',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    await this.bridge(
      store,
      'PUT',
      `/bridge/v1/products/${encodeURIComponent(parentRef.providerId)}/variants/${encodeURIComponent(variantRef.providerId)}/stock`,
      { status: state === 'IN_STOCK' ? 'in_stock' : 'out_of_stock' },
    );
    return { ok: true, ref: variantRef };
  }

  /**
   * Manifest capabilities for write paths: fail CLOSED on manifest
   * outage (throw the fetch error, retryable) rather than writing blind
   * against the safe defaults.
   */
  private async manifestCapabilitiesOrThrow(
    store: StoreWithSecrets,
  ): Promise<ProviderCapabilities> {
    const manifest = await this.fetchManifest(store);
    return bridgeManifestToCapabilities(manifest, this.declaredCapabilities);
  }

  // ── Orders: paged pull, status push, read-back ───────────────────────

  override async fetchOrders(
    store: StoreWithSecrets,
    opts: { since: Date; until: Date; status?: string[]; page: number; pageSize: number },
  ): Promise<{ orders: NormalizedOrder[]; hasMore: boolean }> {
    const caps = await this.resolveCapabilities(store);
    if (!caps.orders) {
      throw new ProviderError(
        '[custom] CAPABILITY_UNSUPPORTED: bridge manifest disables orders',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    const params = new URLSearchParams({
      since: opts.since.toISOString(),
      until: opts.until.toISOString(),
      page: String(Math.max(1, opts.page)),
      page_size: String(Math.min(Math.max(opts.pageSize, 1), 100)),
    });
    if (opts.status && opts.status.length > 0)
      params.set('status', opts.status.join(','));
    const body = await this.bridge<{ orders?: unknown[]; has_more?: unknown }>(
      store,
      'GET',
      `/bridge/v1/orders?${params.toString()}`,
    );
    const orders = ((body.orders ?? []) as NormalizedOrder[]);
    return { orders, hasMore: body.has_more === true };
  }

  override async pushOrderStatus(
    store: StoreWithSecrets,
    ref: RemoteRef,
    target: 'cancelled' | 'completed',
  ): Promise<PushResult> {
    const caps = await this.resolveCapabilities(store);
    if (!caps.orderStatusUpdate || !caps.orderStatusUpdateTargets.includes(target)) {
      throw new ProviderError(
        `[custom] ORDER_STATUS_TARGET_UNSUPPORTED: manifest targets [${caps.orderStatusUpdateTargets.join(',')}] exclude '${target}' (§8.6: explicit skip, never silent)`,
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    await this.bridge(
      store,
      'POST',
      `/bridge/v1/orders/${encodeURIComponent(ref.providerId)}/status`,
      { target },
    );
    return { ok: true, ref };
  }

  /**
   * Read-back verification seam (§8.6): the bridge order `status` string,
   * upper-cased canonically (`cancelled` → CANCELLED). Read-only.
   */
  override async readOrderStatus(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<{ status: string }> {
    const body = await this.bridge<{ status?: unknown; order?: any }>(
      store,
      'GET',
      `/bridge/v1/orders/${encodeURIComponent(ref.providerId)}`,
    );
    const raw =
      (body as any)?.order?.status ?? (body as any)?.status ?? '';
    return { status: String(raw).toUpperCase() || String(raw) };
  }

  override async ensureWebhooks(
    store: StoreWithSecrets,
    callbackBaseUrl: string,
  ): Promise<WebhookRegistrationResult> {
    const caps = await this.resolveCapabilities(store);
    if (!caps.webhooks) {
      throw new ProviderError(
        '[custom] CAPABILITY_UNSUPPORTED: bridge manifest disables webhooks (reconcile remains the safety net, BR-11)',
        ProviderErrorCategory.INVALID_REQUEST,
        'custom',
      );
    }
    const address = `${callbackBaseUrl.replace(/\/+$/, '')}/api/webhooks/stores/custom`;
    const existing = await this.bridge<{ webhooks?: any[] }>(
      store,
      'GET',
      '/bridge/v1/webhooks',
    ).catch(() => ({ webhooks: [] as any[] }));
    const have = new Set(
      (existing.webhooks ?? []).map((h: any) => String(h.topic)),
    );
    const missing = BRIDGE_WEBHOOK_TOPICS.filter((t) => !have.has(t));
    if (missing.length > 0) {
      await this.bridge(store, 'POST', '/bridge/v1/webhooks', {
        url: address,
        topics: missing,
      });
    }
    return { ok: true, topics: BRIDGE_WEBHOOK_TOPICS };
  }
}

// ── Adapter-internal helpers (no core leakage) ─────────────────────────

export function bridgeSlugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Field-scoped payload (Table B "push the changed field only"): project
 * the full payload down to the requested §8.11 keys. `price`/`salePrice`
 * travel together (one bridge pair); `primaryImage`/`galleryImages`
 * re-compose `images`; `productCode`/`barcode` ride `sku`.
 */
function scopePayload(
  payload: Record<string, unknown>,
  fields: FieldKey[],
): Record<string, unknown> {
  const want = new Set(fields);
  const keyOf: Record<string, string[]> = {
    name: ['name'],
    shortDescription: ['short_description'],
    fullDescription: ['description'],
    sku: ['sku'],
    productCode: ['sku'],
    barcode: ['sku'],
    primaryImage: ['images'],
    galleryImages: ['images'],
    category: ['category_ids'],
    brand: ['brand'],
    tags: ['tags'],
    productType: [],
    variants: [],
    variantAttributes: [],
    price: ['price', 'sale_price'],
    salePrice: ['price', 'sale_price'],
    costPrice: ['cost_price'],
    weight: ['weight'],
    dimensions: ['dimensions'],
    seoTitle: ['seo_title'],
    seoDescription: ['seo_description'],
    slug: ['slug'],
    publicationState: ['status'],
    customFields: ['custom_fields'],
  };
  const keys = new Set<string>();
  for (const f of want) {
    for (const k of keyOf[f] ?? []) keys.add(k);
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (payload[k] !== undefined) out[k] = payload[k];
  }
  return out;
}
