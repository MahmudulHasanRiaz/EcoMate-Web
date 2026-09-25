/**
 * Shared stub base for P1 provider adapters (central-commerce §7.1).
 *
 * P1 registers all three slugs and locks the capability matrix. Live HTTP
 * (products, orders, webhooks) lands in P4 (WooCommerce), P9 (Shopify) and
 * P10 (Custom bridge). Every stubbed method throws a named error so a
 * premature call is loud, never a silent no-op.
 */
import { ProviderError, ProviderErrorCategory } from '../../marketing/ad-provider.adapter';
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
  ProviderSlug,
  PushResult,
  RemoteRef,
  StockState,
  StoreWithSecrets,
  TestConnectionResult,
  WebhookRegistrationResult,
  WebhookVerification,
} from './provider.contract';

export function notImplemented(slug: string, method: string): ProviderError {
  return new ProviderError(
    `[${slug}] ${method} is not implemented in P1 — lands in P4/P9/P10`,
    ProviderErrorCategory.UNKNOWN,
    slug,
  );
}

export abstract class BaseCommerceProvider implements CommerceProvider {
  abstract readonly slug: ProviderSlug;
  abstract readonly declaredCapabilities: ProviderCapabilities;

  /** P1: static declaration. P4+: live negotiation (plugin version, etc.). */
  async resolveCapabilities(): Promise<ProviderCapabilities> {
    return this.declaredCapabilities;
  }

  /** P1 skeleton: reports unreachable; live probe lands with the adapter. */
  async testConnection(): Promise<TestConnectionResult> {
    return {
      reachable: false,
      authenticated: false,
      permissionsOk: false,
      capabilities: this.declaredCapabilities,
    };
  }

  protected stub<T>(method: string): Promise<T> {
    return Promise.reject(notImplemented(this.slug, method));
  }

  ensureCategories(
    store: StoreWithSecrets,
    paths: CategoryPath[],
  ): Promise<Map<string, RemoteRef>> {
    void store;
    void paths;
    return this.stub('ensureCategories');
  }

  renameCategory(
    store: StoreWithSecrets,
    ref: RemoteRef,
    next: CategoryInput,
  ): Promise<PushResult> {
    void store;
    void ref;
    void next;
    return this.stub('renameCategory');
  }

  moveCategory(
    store: StoreWithSecrets,
    ref: RemoteRef,
    parent: RemoteRef | null,
  ): Promise<PushResult> {
    void store;
    void ref;
    void parent;
    return this.stub('moveCategory');
  }

  readProductFields(
    store: StoreWithSecrets,
    ref: RemoteRef,
    fields: FieldKey[],
  ): Promise<Record<FieldKey, FieldSnapshot>> {
    void store;
    void ref;
    void fields;
    return this.stub('readProductFields');
  }

  upsertProduct(
    store: StoreWithSecrets,
    input: NormalizedProduct,
    fields: FieldKey[],
  ): Promise<RemoteRef> {
    void store;
    void input;
    void fields;
    return this.stub('upsertProduct');
  }

  upsertVariants(
    store: StoreWithSecrets,
    ref: RemoteRef,
    variants: NormalizedVariant[],
  ): Promise<Map<string, RemoteRef>> {
    void store;
    void ref;
    void variants;
    return this.stub('upsertVariants');
  }

  ensureMedia(
    store: StoreWithSecrets,
    items: NormalizedMedia[],
  ): Promise<Map<string, RemoteRef>> {
    void store;
    void items;
    return this.stub('ensureMedia');
  }

  setPublication(
    store: StoreWithSecrets,
    ref: RemoteRef,
    state: 'published' | 'draft',
  ): Promise<PushResult> {
    void store;
    void ref;
    void state;
    return this.stub('setPublication');
  }

  deleteProduct(store: StoreWithSecrets, ref: RemoteRef): Promise<PushResult> {
    void store;
    void ref;
    return this.stub('deleteProduct');
  }

  readStockState(store: StoreWithSecrets, ref: RemoteRef): Promise<StockState> {
    void store;
    void ref;
    return this.stub('readStockState');
  }

  publishStockState(
    store: StoreWithSecrets,
    ref: RemoteRef,
    state: StockState,
  ): Promise<PushResult> {
    void store;
    void ref;
    void state;
    return this.stub('publishStockState');
  }

  fetchOrders(
    store: StoreWithSecrets,
    opts: { since: Date; until: Date; status?: string[]; page: number; pageSize: number },
  ): Promise<{ orders: NormalizedOrder[]; hasMore: boolean }> {
    void store;
    void opts;
    return this.stub('fetchOrders');
  }

  pushOrderStatus(
    store: StoreWithSecrets,
    ref: RemoteRef,
    target: 'cancelled' | 'completed',
  ): Promise<PushResult> {
    void store;
    void ref;
    void target;
    return this.stub('pushOrderStatus');
  }

  ensureWebhooks(
    store: StoreWithSecrets,
    callbackBaseUrl: string,
  ): Promise<WebhookRegistrationResult> {
    void store;
    void callbackBaseUrl;
    return this.stub('ensureWebhooks');
  }

  verifyWebhook(
    store: StoreWithSecrets,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookVerification {
    void store;
    void headers;
    void rawBody;
    throw notImplemented(this.slug, 'verifyWebhook');
  }
}
