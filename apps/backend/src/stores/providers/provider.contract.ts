/**
 * Commerce provider contract — central-commerce §7 (P1 foundation).
 *
 * Core services branch on `ProviderCapabilities`, never on a provider slug.
 * NATIVE is never a provider: `providerFor()` throws for `kind === 'NATIVE'`
 * (BR-20). Every new surface is double-gated: license feature AND a
 * fail-closed runtime flag (BR-25).
 *
 * P1 ships the contract, the capability matrix and stub adapters for all
 * three slugs. Field/payload shapes (`Normalized*`) grow in P3/P4; the
 * capability flags they gate on are already final here.
 */
import { ProviderErrorCategory } from '../../marketing/ad-provider.adapter';

export { ProviderErrorCategory };

export type ProviderSlug = 'woocommerce' | 'shopify' | 'custom';

/**
 * P13 ERP-STOCK-PROJECTION (operator-directed, SUPERSEDES plan BR-06
 * status-only and BR-08 Shopify zero-write — see
 * docs/central-commerce/P13-ERP-STOCK-PROJECTION.md):
 * "ERP calculates the truth; every integrated store only receives a
 * controlled stock projection." ERP stock = the resolved quantity
 * (INVENTORY_CONTROLLED → inventory-controlled path, else managed-stock
 * quantity). Threshold default 5, per-store override kept.
 * - `faithful` (WooCommerce, quantity-enabled Custom bridge): ERP > 5 →
 *   IN_STOCK status only (no quantity ever); 1–5 → ACTUAL quantity in real
 *   time; 0 → OUT_OF_STOCK.
 * - `quantized-capped` (Shopify): ERP > 5 → capped quantity (threshold,
 *   default 5); 1–5 → actual quantity real-time; 0 → quantity 0 (no sell).
 * - `unsupported`: ZERO writes ever (monitor-only drift audit, BR-08
 *   remainder). Zero-write now applies ONLY to this fidelity.
 */
export type StockStatusFidelity = 'faithful' | 'quantized-capped' | 'unsupported';
export type CategoryModel = 'taxonomy' | 'collection' | 'custom' | 'unsupported';
export type SeoModel = 'native' | 'plugin-meta' | 'unsupported';
export type MediaModel = 'url-fetch' | 'binary-upload' | 'unsupported';

/** How confidently external edits can be attributed. */
export type ExternalEditsDetectable = 'plugin' | 'inferred';

export interface ProviderCapabilities {
  products: boolean;
  variations: boolean;
  variantDelete: boolean;
  categories: boolean;
  media: boolean;
  mediaReuse: boolean;
  delete: boolean;
  seo: boolean;
  costPrice: boolean;
  weight: boolean;
  dimensions: boolean;
  slug: boolean;
  orders: boolean;
  webhooks: boolean;
  orderStatusUpdate: boolean;
  orderStatusUpdateTargets: string[]; // e.g. ['cancelled','completed']
  stockStatusFidelity: StockStatusFidelity; // drives P13 projection / BR-08
  /**
   * P13: exact-quantity push support in the 1–5 band (and the capped band
   * for `quantized-capped`). WooCommerce + Shopify: true (native). Custom
   * bridge: manifest-declared via `capabilities.stockQuantity` (default
   * false → status-only when undeclared). False → the engine sends status
   * only, never a quantity.
   */
  stockQuantity: boolean;
  contactCheckExposure: boolean; // may expose block data to the channel (BR-14)
  categoryModel: CategoryModel;
  seoModel: SeoModel;
  mediaModel: MediaModel;
  combos: boolean; // false for all three in phase 1 (BR-22)
  externalEditsDetectable: ExternalEditsDetectable;
}

/** Minimal store shape the provider layer may depend on. */
export interface StoreWithSecrets {
  id: string;
  kind: string;
  settings?: Record<string, unknown> | null;
  /** Decrypted credential payload. Never logged, never returned by any read. */
  secrets?: Record<string, unknown> | null;
}

export interface TestConnectionResult {
  reachable: boolean;
  authenticated: boolean;
  permissionsOk: boolean;
  mediaReachable?: boolean;
  providerStoreId?: string;
  existingStoreConflict?: { storeId: string; storeName: string };
  plugin?: { installed: boolean; version?: string };
  capabilities: ProviderCapabilities;
  /**
   * API-version negotiation evidence. `served` comes from the
   * `X-Shopify-API-Version`-style response header; `fallForward` is true
   * when the platform served an older/newer version than requested (the
   * request was silently reinterpreted — never assumed identical).
   */
  apiVersion?: { requested: string; served?: string; fallForward: boolean };
}

/** Field keys are owned by the §8.11 matrix (P3/P4). P1 reserves the type. */
export type FieldKey = string;
export type FieldSnapshot = { hash: string; value?: unknown };
export type CategoryPath = string[];
export interface CategoryInput {
  name: string;
  slug: string;
  parentId?: string | null;
}
export interface RemoteRef {
  providerId: string;
  url?: string;
}
/** Normalized shapes are fully specified in P3/P4; kept opaque in P1. */
export type NormalizedProduct = Record<string, unknown>;
export type NormalizedVariant = Record<string, unknown>;
export type NormalizedMedia = Record<string, unknown>;
export type NormalizedOrder = Record<string, unknown>;
export type StockState = 'IN_STOCK' | 'OUT_OF_STOCK';
/**
 * P13 controlled stock projection: the ERP-resolved quantity (already
 * threshold-banded by the engine) a provider renders into its native wire
 * shape. `qty` is an exact unit count the remote must express (Woo
 * `stock_quantity`, Shopify `InventoryLevel.available`, bridge `quantity`);
 * `capped` marks the >threshold quantized band (Shopify writes the cap, not
 * the truth — oversell is impossible since the remote never sees the real
 * count above the band).
 */
export interface StockProjection {
  state: StockState;
  /** Exact ERP units for the 1–5 band, the cap for the above band, 0 for zero. */
  qty: number;
  /** True when `qty` is the quantized cap (remote must not sell past it). */
  capped: boolean;
}
export interface PushResult {
  ok: boolean;
  ref?: RemoteRef;
  skipped?: boolean;
  reason?: string;
}
export interface WebhookRegistrationResult {
  ok: boolean;
  topics: string[];
  reason?: string;
}
export interface WebhookVerification {
  valid: boolean;
  deliveryId?: string;
  topic?: string;
  reason?: string;
}

export interface CommerceProvider {
  readonly slug: ProviderSlug;
  readonly declaredCapabilities: ProviderCapabilities;
  /**
   * P2: the §8.11 Table A field keys this adapter can sync. MUST be a
   * subset of the matrix (asserted by the contract suite); the full
   * per-field behaviour matrix lands in P4. Optional on the interface so
   * the contract stays backward-compatible; required by BaseCommerceProvider.
   */
  readonly syncedFields?: FieldKey[];
  resolveCapabilities(store: StoreWithSecrets): Promise<ProviderCapabilities>;
  testConnection(store: StoreWithSecrets): Promise<TestConnectionResult>;
  ensureCategories(
    store: StoreWithSecrets,
    paths: CategoryPath[],
  ): Promise<Map<string, RemoteRef>>;
  renameCategory(
    store: StoreWithSecrets,
    ref: RemoteRef,
    next: CategoryInput,
  ): Promise<PushResult>;
  moveCategory(
    store: StoreWithSecrets,
    ref: RemoteRef,
    parent: RemoteRef | null,
  ): Promise<PushResult>;
  readProductFields(
    store: StoreWithSecrets,
    ref: RemoteRef,
    fields: FieldKey[],
  ): Promise<Record<FieldKey, FieldSnapshot>>;
  upsertProduct(
    store: StoreWithSecrets,
    input: NormalizedProduct,
    fields: FieldKey[],
  ): Promise<RemoteRef>;
  upsertVariants(
    store: StoreWithSecrets,
    ref: RemoteRef,
    variants: NormalizedVariant[],
  ): Promise<Map<string, RemoteRef>>;
  ensureMedia(
    store: StoreWithSecrets,
    items: NormalizedMedia[],
  ): Promise<Map<string, RemoteRef>>;
  setPublication(
    store: StoreWithSecrets,
    ref: RemoteRef,
    state: 'published' | 'draft',
  ): Promise<PushResult>;
  /** Capability-gated, no mode arg (BR-09). */
  deleteProduct(store: StoreWithSecrets, ref: RemoteRef): Promise<PushResult>;
  readStockState(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<StockState>;
  /** Never called when fidelity === 'unsupported' (BR-08 remainder). */
  publishStockState(
    store: StoreWithSecrets,
    ref: RemoteRef,
    state: StockState,
  ): Promise<PushResult>;
  /**
   * P13 quantity projection (1–5 exact band, capped above band, 0 = no
   * sell). Optional so the contract stays backward-compatible; the engine
   * calls these ONLY when `capabilities.stockQuantity === true` AND the
   * method exists, otherwise it falls back to the status-only path above.
   * Never called when fidelity === 'unsupported' (zero writes).
   */
  publishStockQuantity?(
    store: StoreWithSecrets,
    ref: RemoteRef,
    qty: number,
  ): Promise<PushResult>;
  publishVariantStockQuantity?(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
    qty: number,
  ): Promise<PushResult>;
  /**
   * P13 quantity read-back for verify-after-push. Optional; `null` means
   * "quantity not observable" and the engine falls back to a status
   * read-back. Never called when fidelity === 'unsupported' except by the
   * read-only drift audit (same as readStockState).
   */
  readStockQuantity?(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<number | null>;
  readVariantStockQuantity?(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): Promise<number | null>;
  /**
   * P5 variation-scoped stock. Adapters with `variations: true` and true
   * per-variation stock implement these (WooCommerce, Shopify P13,
   * quantity-enabled bridge); the base default throws
   * `VARIANT_STOCK_UNSUPPORTED` so a missing implementation is loud and the
   * stock engine records SKIPPED instead of pushing to the wrong remote
   * object. `parentRef` is the product-level remote ref, `variantRef` the
   * variation-level remote ref.
   */
  readVariantStockState?(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): Promise<StockState>;
  publishVariantStockState?(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
    state: StockState,
  ): Promise<PushResult>;
  fetchOrders(
    store: StoreWithSecrets,
    opts: {
      since: Date;
      until: Date;
      status?: string[];
      page: number;
      pageSize: number;
    },
  ): Promise<{ orders: NormalizedOrder[]; hasMore: boolean }>;
  pushOrderStatus(
    store: StoreWithSecrets,
    ref: RemoteRef,
    target: 'cancelled' | 'completed',
  ): Promise<PushResult>;
  /**
   * P7 (§8.6): read the remote order's current status for read-back
   * verification after pushOrderStatus. Optional so the contract stays
   * backward-compatible; the base default throws (loud, never a silent
   * verify-pass). WooCommerce implements live in P7; Shopify/Custom stay
   * stubbed-but-contract-explicit until P9/P10.
   */
  readOrderStatus?(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<{ status: string }>;
  ensureWebhooks(
    store: StoreWithSecrets,
    callbackBaseUrl: string,
  ): Promise<WebhookRegistrationResult>;
  verifyWebhook(
    store: StoreWithSecrets,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookVerification;
}
