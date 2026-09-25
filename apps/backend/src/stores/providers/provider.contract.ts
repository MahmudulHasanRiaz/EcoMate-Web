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

export type StockStatusFidelity = 'faithful' | 'unsupported'; // no 'quantized' (BR-06)
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
  stockStatusFidelity: StockStatusFidelity; // drives BR-06/BR-07/BR-08
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
  /** Never called when fidelity === 'unsupported' (BR-08). */
  publishStockState(
    store: StoreWithSecrets,
    ref: RemoteRef,
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
