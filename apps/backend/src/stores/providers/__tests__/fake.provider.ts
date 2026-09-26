/**
 * FakeProvider — central-commerce P2 (§13 provider contract suite).
 *
 * In-memory, deterministic, latency-free `CommerceProvider` for kind
 * 'custom'. TEST-ONLY: never registered in `StoresModule`, never wired to
 * a route; instantiated directly by the contract suite (and later P4/P9/P10
 * engine tests). Implements the FULL contract so the suite is green here
 * and is the gate every real adapter must satisfy.
 *
 * Scripted behaviour: products/variants/media/categories/orders seeded via
 * `directSeed*` (see `__tests__/fixtures.seedFakeProvider`), stock states
 * per product, failure injection (auth/permission/transient) via
 * `injectFailure`, and a `calls` log every vector asserts against.
 *
 * Order pagination convention (P2 fixture contract): `page` is 1-based.
 */
import { ProviderError, ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import type {
  CategoryInput,
  CategoryPath,
  CommerceProvider,
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
} from '../provider.contract';
import { snapshotField } from '../field-snapshot';
import {
  getHeader,
  isTimestampFresh,
  safeEqualString,
  signCustomDelivery,
} from '../webhook-crypto';
import type { FixtureVariantInput } from './fixtures';

export interface FakeFailureSpec {
  /** Omit to fail the next call to ANY method. */
  method?: string;
  times: number;
  category: ProviderErrorCategory;
  message?: string;
}

export interface FakeCall {
  method: string;
  detail: Record<string, unknown>;
}

interface FakeRemoteProduct {
  ref: RemoteRef;
  fields: Record<string, unknown>;
  publication: 'published' | 'draft';
  stockState: StockState;
  /** P13: remote countable units (exact band / capped band / 0). */
  stockQuantity: number | null;
  variants: Map<string, { ref: RemoteRef; data: Record<string, unknown>; stockState: StockState; stockQuantity: number | null }>;
}

function skuOf(input: Record<string, unknown>): string {
  const sku = input.sku;
  if (typeof sku !== 'string' || sku.length === 0) {
    throw new ProviderError(
      '[fake] upsert requires a non-empty sku',
      ProviderErrorCategory.INVALID_REQUEST,
      'custom',
    );
  }
  return sku;
}

export class FakeProvider implements CommerceProvider {
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
    costPrice: false, // never customer-facing (BR-23)
    weight: true,
    dimensions: true,
    slug: true,
    orders: true,
    webhooks: true,
    orderStatusUpdate: true,
    orderStatusUpdateTargets: ['cancelled', 'completed'],
    stockStatusFidelity: 'faithful', // P13 projection-capable (status + exact qty)
    stockQuantity: true, // exact-quantity band supported
    contactCheckExposure: true,
    categoryModel: 'custom',
    seoModel: 'native',
    mediaModel: 'url-fetch',
    combos: false, // BR-22
    externalEditsDetectable: 'inferred',
  };

  readonly syncedFields: FieldKey[] = [
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

  /** Append-only call log — stock-fidelity and zero-write vectors read this. */
  readonly calls: FakeCall[] = [];

  private products = new Map<string, FakeRemoteProduct>();
  private productsBySku = new Map<string, string>();
  private categories = new Map<string, RemoteRef>();
  private mediaByHash = new Map<string, RemoteRef>();
  private mediaBySrc = new Map<string, RemoteRef>();
  /** Uploads only (dedup hits are not uploads) — media-reuse vector reads this. */
  readonly uploads: { src: string; hash: string }[] = [];
  private orders: NormalizedOrder[] = [];
  private failures: FakeFailureSpec[] = [];
  private counters = { product: 0, variant: 0, media: 0, category: 0 };
  /**
   * P7: remote order statuses keyed by external order id. `pushOrderStatus`
   * writes, `readOrderStatus` reads — the read-back verification vector.
   */
  private remoteOrderStatuses = new Map<string, string>();

  constructor(readonly webhookSecret = 'fake-webhook-secret') {}

  /**
   * P13 test seam: stage the fake as a `quantized-capped` (Shopify-like)
   * provider. `resolveCapabilities` reports the override; the quantity
   * methods then cap writes at `capQty` (default 5) exactly like the
   * engine's wire-qty rule, so the stock suite can assert the capped band
   * without HTTP.
   */
  private fidelityOverride: 'faithful' | 'quantized-capped' | 'unsupported' | null = null;
  private capQty = 5;

  setFidelity(
    fidelity: 'faithful' | 'quantized-capped' | 'unsupported' | null,
    capQty = 5,
  ): void {
    this.fidelityOverride = fidelity;
    this.capQty = capQty;
  }

  // ── Seeding (fixtures only) ─────────────────────────────────────────

  directSeed(
    providerId: string,
    input: Record<string, unknown>,
    stockState: StockState = 'IN_STOCK',
    publication: 'published' | 'draft' = 'draft',
    variants: FixtureVariantInput[] = [],
  ): RemoteRef {
    const ref = { providerId };
    const record: FakeRemoteProduct = {
      ref,
      fields: { ...input },
      publication,
      stockState,
      stockQuantity: stockState === 'IN_STOCK' ? null : 0,
      variants: new Map(),
    };
    for (const v of variants) {
      this.counters.variant += 1;
      record.variants.set(v.sku, {
        ref: { providerId: `fake-var-${this.counters.variant}` },
        data: { ...v },
        stockState: 'IN_STOCK',
        stockQuantity: null,
      });
    }
    this.products.set(providerId, record);
    this.productsBySku.set(skuOf(input), providerId);
    return ref;
  }

  directSeedOrder(order: NormalizedOrder): void {
    this.orders.push({ ...order });
  }

  /**
   * P7: seed a remote order status (the value `readOrderStatus` returns).
   * Lets tests stage verify-pass AND verify-mismatch without HTTP.
   */
  directSeedOrderStatus(externalOrderId: string, status: string): void {
    this.remoteOrderStatuses.set(externalOrderId, status);
  }

  /** P7: white-box read of the last pushed remote status. */
  remoteOrderStatus(externalOrderId: string): string | undefined {
    return this.remoteOrderStatuses.get(externalOrderId);
  }

  // ── Failure injection ───────────────────────────────────────────────

  /** The next `times` calls to `method` (or any method) throw `category`. */
  injectFailure(spec: FakeFailureSpec): void {
    this.failures.push({ ...spec });
  }

  private maybeFail(method: string): void {
    const idx = this.failures.findIndex(
      (f) => f.times > 0 && (!f.method || f.method === method),
    );
    if (idx === -1) return;
    const spec = this.failures[idx] as FakeFailureSpec;
    spec.times -= 1;
    throw new ProviderError(
      spec.message ?? `[fake] injected ${spec.category} in ${method}`,
      spec.category,
      this.slug,
    );
  }

  private log(method: string, detail: Record<string, unknown> = {}): void {
    this.calls.push({ method, detail });
  }

  // ── Introspection (white-box assertions for the suite) ──────────────

  productCount(): number {
    return this.products.size;
  }

  getProduct(providerId: string): FakeRemoteProduct | undefined {
    return this.products.get(providerId);
  }

  findBySku(sku: string): FakeRemoteProduct | undefined {
    const id = this.productsBySku.get(sku);
    return id ? this.products.get(id) : undefined;
  }

  // ── Contract: capabilities / connection ─────────────────────────────

  async resolveCapabilities(): Promise<ProviderCapabilities> {
    this.maybeFail('resolveCapabilities');
    this.log('resolveCapabilities');
    return {
      ...this.declaredCapabilities,
      ...(this.fidelityOverride ? { stockStatusFidelity: this.fidelityOverride } : {}),
    };
  }

  async testConnection(): Promise<TestConnectionResult> {
    this.maybeFail('testConnection');
    this.log('testConnection');
    return {
      reachable: true,
      authenticated: true,
      permissionsOk: true,
      mediaReachable: true,
      providerStoreId: 'fake-store-1',
      capabilities: { ...this.declaredCapabilities },
    };
  }

  // ── Contract: categories ────────────────────────────────────────────

  async ensureCategories(
    store: StoreWithSecrets,
    paths: CategoryPath[],
  ): Promise<Map<string, RemoteRef>> {
    void store;
    this.maybeFail('ensureCategories');
    const out = new Map<string, RemoteRef>();
    for (const path of paths) {
      const key = path.join(' / ');
      let ref = this.categories.get(key);
      if (!ref) {
        this.counters.category += 1;
        ref = { providerId: `fake-cat-${this.counters.category}` };
        this.categories.set(key, ref);
      }
      out.set(key, ref);
    }
    this.log('ensureCategories', { paths });
    return out;
  }

  async renameCategory(
    store: StoreWithSecrets,
    ref: RemoteRef,
    next: CategoryInput,
  ): Promise<PushResult> {
    void store;
    this.maybeFail('renameCategory');
    this.log('renameCategory', { ref, next });
    return { ok: true, ref };
  }

  async moveCategory(
    store: StoreWithSecrets,
    ref: RemoteRef,
    parent: RemoteRef | null,
  ): Promise<PushResult> {
    void store;
    this.maybeFail('moveCategory');
    this.log('moveCategory', { ref, parent });
    return { ok: true, ref };
  }

  // ── Contract: products / variants / media / publication ─────────────

  async readProductFields(
    store: StoreWithSecrets,
    ref: RemoteRef,
    fields: FieldKey[],
  ): Promise<Record<FieldKey, FieldSnapshot>> {
    void store;
    this.maybeFail('readProductFields');
    const record = this.products.get(ref.providerId);
    if (!record) {
      throw new ProviderError(
        `[fake] unknown product ${ref.providerId}`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        this.slug,
      );
    }
    const out: Record<FieldKey, FieldSnapshot> = {};
    for (const field of fields) {
      out[field] = snapshotField(record.fields[field]);
    }
    this.log('readProductFields', { ref, fields });
    return out;
  }

  async upsertProduct(
    store: StoreWithSecrets,
    input: NormalizedProduct,
    fields: FieldKey[],
  ): Promise<RemoteRef> {
    void store;
    this.maybeFail('upsertProduct');
    const sku = skuOf(input);
    const existingId = this.productsBySku.get(sku);
    if (existingId) {
      // Idempotent: same sku → same ref; only the listed fields are written.
      const record = this.products.get(existingId) as FakeRemoteProduct;
      for (const field of fields) {
        if (field in input) record.fields[field] = input[field];
      }
      this.log('upsertProduct', { sku, fields, created: false });
      return record.ref;
    }
    this.counters.product += 1;
    const ref = { providerId: `fake-prod-${this.counters.product}` };
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in input) initial[field] = input[field];
    }
    initial.sku = sku;
    this.products.set(ref.providerId, {
      ref,
      fields: initial,
      publication: 'draft',
      stockState: 'IN_STOCK',
      stockQuantity: null,
      variants: new Map(),
    });
    this.productsBySku.set(sku, ref.providerId);
    this.log('upsertProduct', { sku, fields, created: true });
    return ref;
  }

  async upsertVariants(
    store: StoreWithSecrets,
    ref: RemoteRef,
    variants: NormalizedVariant[],
  ): Promise<Map<string, RemoteRef>> {
    void store;
    this.maybeFail('upsertVariants');
    const record = this.products.get(ref.providerId);
    if (!record) {
      throw new ProviderError(
        `[fake] unknown product ${ref.providerId}`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        this.slug,
      );
    }
    const out = new Map<string, RemoteRef>();
    for (const v of variants) {
      const data = v as Record<string, unknown>;
      const sku = skuOf(data);
      let slot = record.variants.get(sku);
      if (!slot) {
        this.counters.variant += 1;
        slot = {
          ref: { providerId: `fake-var-${this.counters.variant}` },
          data: {},
          stockState: 'IN_STOCK',
          stockQuantity: null,
        };
        record.variants.set(sku, slot);
      }
      slot.data = { ...data };
      out.set(sku, slot.ref);
    }
    this.log('upsertVariants', {
      ref,
      skus: variants.map((v) => (v as Record<string, unknown>).sku),
    });
    return out;
  }

  async ensureMedia(
    store: StoreWithSecrets,
    items: NormalizedMedia[],
  ): Promise<Map<string, RemoteRef>> {
    void store;
    this.maybeFail('ensureMedia');
    const out = new Map<string, RemoteRef>();
    for (const item of items) {
      const entry = item as unknown as { src: string; hash: string };
      const byHash = this.mediaByHash.get(entry.hash);
      if (byHash) {
        // Reuse: no new upload, same remote id.
        this.mediaBySrc.set(entry.src, byHash);
        out.set(entry.src, byHash);
        continue;
      }
      this.counters.media += 1;
      const ref = { providerId: `fake-media-${this.counters.media}` };
      this.mediaByHash.set(entry.hash, ref);
      this.mediaBySrc.set(entry.src, ref);
      this.uploads.push({ src: entry.src, hash: entry.hash });
      out.set(entry.src, ref);
    }
    this.log('ensureMedia', { srcs: items.map((i) => (i as unknown as { src: string }).src) });
    return out;
  }

  async setPublication(
    store: StoreWithSecrets,
    ref: RemoteRef,
    state: 'published' | 'draft',
  ): Promise<PushResult> {
    void store;
    this.maybeFail('setPublication');
    const record = this.products.get(ref.providerId);
    if (!record) {
      throw new ProviderError(
        `[fake] unknown product ${ref.providerId}`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        this.slug,
      );
    }
    record.publication = state;
    this.log('setPublication', { ref, state });
    return { ok: true, ref };
  }

  async deleteProduct(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<PushResult> {
    void store;
    this.maybeFail('deleteProduct');
    const record = this.products.get(ref.providerId);
    if (!record) {
      throw new ProviderError(
        `[fake] unknown product ${ref.providerId}`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        this.slug,
      );
    }
    const sku = record.fields.sku;
    this.products.delete(ref.providerId);
    if (typeof sku === 'string') this.productsBySku.delete(sku);
    this.log('deleteProduct', { ref });
    return { ok: true };
  }

  // ── Contract: stock (P13 projection: status + exact/capped qty) ─────

  async readStockState(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<StockState> {
    void store;
    this.maybeFail('readStockState');
    const record = this.products.get(ref.providerId);
    if (!record) {
      throw new ProviderError(
        `[fake] unknown product ${ref.providerId}`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        this.slug,
      );
    }
    this.log('readStockState', { ref });
    return record.stockState;
  }

  async publishStockState(
    store: StoreWithSecrets,
    ref: RemoteRef,
    state: StockState,
  ): Promise<PushResult> {
    void store;
    this.maybeFail('publishStockState');
    const record = this.products.get(ref.providerId);
    if (!record) {
      throw new ProviderError(
        `[fake] unknown product ${ref.providerId}`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        this.slug,
      );
    }
    // Above-band path: status ONLY — the logged detail carries { ref, state }
    // and MUST never carry a quantity (asserted by the P13 matrix suite).
    record.stockState = state;
    record.stockQuantity = null;
    this.log('publishStockState', { ref, state });
    return { ok: true, ref };
  }

  /**
   * P13 exact/capped quantity push. In `quantized-capped` override mode the
   * fake enforces the cap itself (writes min(qty, cap)) so the suite
   * observes the same quantized semantics as Shopify without HTTP.
   */
  async publishStockQuantity(
    store: StoreWithSecrets,
    ref: RemoteRef,
    qty: number,
  ): Promise<PushResult> {
    void store;
    this.maybeFail('publishStockQuantity');
    const record = this.products.get(ref.providerId);
    if (!record) {
      throw new ProviderError(
        `[fake] unknown product ${ref.providerId}`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        this.slug,
      );
    }
    const n = Math.max(0, Math.floor(qty));
    const effective =
      this.fidelityOverride === 'quantized-capped' ? Math.min(n, this.capQty) : n;
    record.stockQuantity = effective;
    record.stockState = effective > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
    this.log('publishStockQuantity', { ref, qty: effective });
    return { ok: true, ref };
  }

  async publishVariantStockQuantity(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
    qty: number,
  ): Promise<PushResult> {
    void store;
    this.maybeFail('publishVariantStockQuantity');
    const slot = this.findVariantSlot(parentRef, variantRef);
    const n = Math.max(0, Math.floor(qty));
    const effective =
      this.fidelityOverride === 'quantized-capped' ? Math.min(n, this.capQty) : n;
    slot.stockQuantity = effective;
    slot.stockState = effective > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
    this.log('publishVariantStockQuantity', { parentRef, variantRef, qty: effective });
    return { ok: true, ref: variantRef };
  }

  async readStockQuantity(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<number | null> {
    void store;
    this.maybeFail('readStockQuantity');
    const record = this.products.get(ref.providerId);
    if (!record) {
      throw new ProviderError(
        `[fake] unknown product ${ref.providerId}`,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        this.slug,
      );
    }
    this.log('readStockQuantity', { ref });
    return record.stockQuantity;
  }

  async readVariantStockQuantity(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): Promise<number | null> {
    void store;
    this.maybeFail('readVariantStockQuantity');
    const slot = this.findVariantSlot(parentRef, variantRef);
    this.log('readVariantStockQuantity', { parentRef, variantRef });
    return slot.stockQuantity;
  }

  async readVariantStockState(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): Promise<StockState> {
    void store;
    this.maybeFail('readVariantStockState');
    const slot = this.findVariantSlot(parentRef, variantRef);
    this.log('readVariantStockState', { parentRef, variantRef });
    return slot.stockState;
  }

  async publishVariantStockState(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
    state: StockState,
  ): Promise<PushResult> {
    void store;
    this.maybeFail('publishVariantStockState');
    const slot = this.findVariantSlot(parentRef, variantRef);
    // Above-band path: { parentRef, variantRef, state } MUST never carry a
    // quantity (P13 matrix suite).
    slot.stockState = state;
    slot.stockQuantity = null;
    this.log('publishVariantStockState', { parentRef, variantRef, state });
    return { ok: true, ref: variantRef };
  }

  private findVariantSlot(
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): { ref: RemoteRef; data: Record<string, unknown>; stockState: StockState; stockQuantity: number | null } {
    const record = this.products.get(parentRef.providerId);
    for (const slot of record?.variants.values() ?? []) {
      if (slot.ref.providerId === variantRef.providerId) return slot;
    }
    throw new ProviderError(
      `[fake] unknown variant ${variantRef.providerId} of ${parentRef.providerId}`,
      ProviderErrorCategory.REMOTE_NOT_FOUND,
      this.slug,
    );
  }

  // ── Contract: orders ────────────────────────────────────────────────

  async fetchOrders(
    store: StoreWithSecrets,
    opts: { since: Date; until: Date; status?: string[]; page: number; pageSize: number },
  ): Promise<{ orders: NormalizedOrder[]; hasMore: boolean }> {
    void store;
    this.maybeFail('fetchOrders');
    const sinceMs = opts.since.getTime();
    const untilMs = opts.until.getTime();
    const filtered = this.orders
      .filter((o) => {
        const created = new Date(
          (o as unknown as { createdAt: string }).createdAt,
        ).getTime();
        // Window is inclusive on both edges (P2 fixture contract).
        if (Number.isNaN(created) || created < sinceMs || created > untilMs) return false;
        if (opts.status && opts.status.length > 0) {
          return opts.status.includes((o as unknown as { status: string }).status);
        }
        return true;
      })
      .sort(
        (a, b) =>
          new Date((a as unknown as { createdAt: string }).createdAt).getTime() -
          new Date((b as unknown as { createdAt: string }).createdAt).getTime(),
      );
    // `page` is 1-based (P2 fixture contract).
    const start = (Math.max(1, opts.page) - 1) * opts.pageSize;
    const slice = filtered.slice(start, start + opts.pageSize);
    this.log('fetchOrders', {
      since: opts.since.toISOString(),
      until: opts.until.toISOString(),
      status: opts.status,
      page: opts.page,
      pageSize: opts.pageSize,
      returned: slice.length,
    });
    return { orders: slice.map((o) => ({ ...o })), hasMore: start + opts.pageSize < filtered.length };
  }

  async pushOrderStatus(
    store: StoreWithSecrets,
    ref: RemoteRef,
    target: 'cancelled' | 'completed',
  ): Promise<PushResult> {
    void store;
    this.maybeFail('pushOrderStatus');
    this.log('pushOrderStatus', { ref, target });
    if (!this.declaredCapabilities.orderStatusUpdateTargets.includes(target)) {
      return { ok: false, skipped: true, reason: `unsupported-target:${target}` };
    }
    // P7: a real push lands remotely — the read-back vector observes it.
    this.remoteOrderStatuses.set(ref.providerId, target);
    return { ok: true, ref };
  }

  /** P7 read-back: returns the last pushed/seeded remote status ('' = unknown). */
  async readOrderStatus(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<{ status: string }> {
    void store;
    this.maybeFail('readOrderStatus');
    this.log('readOrderStatus', { ref });
    return { status: this.remoteOrderStatuses.get(ref.providerId) ?? '' };
  }

  // ── Contract: webhooks (custom-bridge HMAC scheme) ───────────────────

  async ensureWebhooks(
    store: StoreWithSecrets,
    callbackBaseUrl: string,
  ): Promise<WebhookRegistrationResult> {
    void store;
    this.maybeFail('ensureWebhooks');
    this.log('ensureWebhooks', { callbackBaseUrl });
    return {
      ok: true,
      topics: ['order.created', 'order.updated', 'product.updated'],
    };
  }

  verifyWebhook(
    store: StoreWithSecrets,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookVerification {
    this.maybeFail('verifyWebhook');
    const secret =
      String(store.secrets?.webhookSecret ?? this.webhookSecret ?? '');
    if (!secret) return { valid: false, reason: 'no-secret-configured' };
    const signature = getHeader(headers, 'X-EcoMate-Signature');
    const deliveryId = getHeader(headers, 'X-EcoMate-Delivery-Id');
    const timestamp = getHeader(headers, 'X-EcoMate-Timestamp');
    if (!signature) return { valid: false, reason: 'missing-signature' };
    if (!deliveryId) return { valid: false, reason: 'missing-delivery-id' };
    if (!isTimestampFresh(timestamp)) {
      return { valid: false, reason: 'stale-timestamp' };
    }
    const expected = signCustomDelivery(secret, deliveryId, timestamp as string, rawBody);
    if (!safeEqualString(signature, expected)) {
      return { valid: false, reason: 'bad-signature' };
    }
    this.log('verifyWebhook', { deliveryId });
    return { valid: true, deliveryId, topic: getHeader(headers, 'X-EcoMate-Topic') };
  }
}
