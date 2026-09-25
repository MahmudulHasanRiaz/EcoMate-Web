/**
 * Shared stub base for P1 provider adapters (central-commerce §7.1).
 *
 * P1 registers all three slugs and locks the capability matrix. Live HTTP
 * (products, orders, webhooks) lands in P4 (WooCommerce), P9 (Shopify) and
 * P10 (Custom bridge). Every stubbed method throws a named error so a
 * premature call is loud, never a silent no-op.
 *
 * P2 additions (additive): injected `fetch` (unit tests pass a MockFetch;
 * P4/P9/P10 reuse the same seam), a fidelity gate on `publishStockState`
 * (BR-08: `unsupported` throws with ZERO writes), and the required
 * `syncedFields` declaration (§8.11 Table A subset).
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

/** Named fail-closed error for the BR-08 zero-write gate. */
export function stockWritesUnsupported(slug: string): ProviderError {
  return new ProviderError(
    `[${slug}] stock writes are unsupported (BR-08: monitor-only, zero writes)`,
    ProviderErrorCategory.INVALID_REQUEST,
    slug,
  );
}

/** Minimal structural HTTP surface: real fetch Responses satisfy this. */
export interface ProbeHttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface ProbeHttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Injected HTTP seam — P2 contract tests pass a MockFetch; P4/P9/P10 reuse. */
export type FetchFn = (
  url: string,
  init?: ProbeHttpInit,
) => Promise<ProbeHttpResponse>;

const defaultFetch: FetchFn = (url, init) =>
  fetch(url, init as RequestInit) as unknown as Promise<ProbeHttpResponse>;

export abstract class BaseCommerceProvider implements CommerceProvider {
  abstract readonly slug: ProviderSlug;
  abstract readonly declaredCapabilities: ProviderCapabilities;
  /** §8.11 Table A subset — every entry must exist in the matrix. */
  abstract readonly syncedFields: FieldKey[];

  protected fetchFn: FetchFn;

  /** Nest DI constructs with no args (global fetch); tests inject a mock. */
  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? defaultFetch;
  }

  /** Swap the HTTP seam after construction (contract-suite wiring). */
  setFetchFn(fetchFn: FetchFn): void {
    this.fetchFn = fetchFn;
  }

  /**
   * Execute one probe request. Network failures throw TEMPORARY_FAILURE
   * (retryable); HTTP statuses are returned for the caller to classify —
   * any response at all implies reachability.
   */
  protected async probeJson(
    url: string,
    init?: ProbeHttpInit,
  ): Promise<{ status: number; body: unknown }> {
    let res: ProbeHttpResponse;
    try {
      res = await this.fetchFn(url, init);
    } catch (err) {
      throw new ProviderError(
        `[${this.slug}] probe request failed: ${err instanceof Error ? err.message : String(err)}`,
        ProviderErrorCategory.TEMPORARY_FAILURE,
        this.slug,
        err,
      );
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  /**
   * Null-on-failure probe for `testConnection`: a network failure means
   * "unreachable" as data (all-false result), never a throw — the P1
   * skeleton never threw and the connect wizard renders results, not
   * exceptions. Sync jobs classify the raw error via `classifyProviderError`.
   */
  protected async tryProbe(
    url: string,
    init?: ProbeHttpInit,
  ): Promise<{ status: number; body: unknown } | null> {
    try {
      return await this.probeJson(url, init);
    } catch {
      return null;
    }
  }
  /**
   * Map a probe status to wizard-renderable results: 200 → fully ok;
   * 403 → permission failed; any other response → reachable but not
   * authenticated. Callers pass the provider-specific store id extraction.
   */
  protected connectionFromProbe(
    status: number,
    body: unknown,
    providerStoreId: string | undefined,
    capabilities: ProviderCapabilities,
    mediaReachable?: boolean,
  ): TestConnectionResult {
    if (status === 200) {
      return {
        reachable: true,
        authenticated: true,
        permissionsOk: true,
        mediaReachable,
        providerStoreId,
        capabilities,
      };
    }
    if (status === 403) {
      return {
        reachable: true,
        authenticated: true,
        permissionsOk: false,
        mediaReachable,
        capabilities,
      };
    }
    return {
      reachable: status === 401 ? true : status > 0,
      authenticated: false,
      permissionsOk: false,
      mediaReachable,
      capabilities,
    };
  }

  /** P1: static declaration. P4+: live negotiation (plugin version, etc.). */
  async resolveCapabilities(store: StoreWithSecrets): Promise<ProviderCapabilities> {
    void store;
    return this.declaredCapabilities;
  }

  /** P1 skeleton: reports unreachable; live probe lands with the adapter. */
  async testConnection(store: StoreWithSecrets): Promise<TestConnectionResult> {
    void store;
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
    // BR-08 fidelity gate (P2): an unsupported-fidelity provider throws
    // BEFORE any HTTP seam is touched — zero writes, provable by call log.
    if (this.declaredCapabilities.stockStatusFidelity === 'unsupported') {
      return Promise.reject(stockWritesUnsupported(this.slug));
    }
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
