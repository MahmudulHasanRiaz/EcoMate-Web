/**
 * Reference stub bridge — central-commerce P10 (test-only).
 *
 * An in-memory implementation of EXACTLY `docs/central-commerce/
 * BRIDGE-V1-PROTOCOL.md`, served through the P2 `MockFetch` seam. It is the
 * proof that a custom store connects using only the documented spec: the
 * conformance suite drives the REAL `CustomBridgeProvider` against this
 * stub, and the adapter may only speak documented endpoints (any
 * undocumented path 404s here).
 *
 * Nothing in this file ships: it lives in `__tests__` and is imported only
 * by specs.
 */
import type { MockHandler } from './fixtures';
import { jsonResponse } from './fixtures';

export interface ReferenceBridgeOrder {
  id: string;
  status: string;
  total: string;
  currency: string;
  created_at: string;
  updated_at: string;
  customer?: { name?: string; phone?: string; email?: string };
  line_items: { sku: string; name: string; quantity: number; price: string }[];
}

export interface ReferenceBridgeOptions {
  /** Base URL the stub serves (default `https://bridge.example.test`). */
  baseUrl?: string;
  /** Expected bearer key (default `bridge_test_key`; wrong key → 401). */
  bridgeKey?: string;
  /** `storeId` reported by the manifest (default `bridge-store-1`). */
  storeId?: string;
  /** Capability overrides merged over the full-truthful manifest. */
  capabilities?: Record<string, unknown>;
  /** Manifest corruption modes (validation vectors). */
  invalidManifest?: 'missing-storeId' | 'not-object' | null;
  stockStatusFidelity?: 'faithful' | 'quantized-capped' | 'unsupported';
  /** When false, category re-parent answers 422 capability_unsupported. */
  supportCategoryMove?: boolean;
}

const FULL_CAPABILITIES: Record<string, unknown> = {
  products: true,
  variations: true,
  variantDelete: true,
  categories: true,
  media: true,
  mediaReuse: true,
  delete: true,
  seo: true,
  costPrice: false,
  weight: true,
  dimensions: true,
  slug: true,
  orders: true,
  webhooks: true,
  orderStatusUpdate: true,
  orderStatusUpdateTargets: ['cancelled', 'completed'],
  stockStatusFidelity: 'faithful',
  // P13: quantity projection is opt-in on the wire (default status-only
  // when undeclared — the provider resolves stockQuantity: false).
  stockQuantity: false,
  contactCheckExposure: true,
  combos: false,
};

export function referenceBridgeOrders(): ReferenceBridgeOrder[] {
  const days: Array<[string, string, string]> = [
    ['ext-order-1', '2026-09-20T10:00:00.000Z', 'processing'],
    ['ext-order-2', '2026-09-21T11:00:00.000Z', 'completed'],
    ['ext-order-3', '2026-09-22T12:00:00.000Z', 'pending'],
    ['ext-order-4', '2026-09-23T13:00:00.000Z', 'processing'],
    ['ext-order-5', '2026-09-24T14:00:00.000Z', 'cancelled'],
  ];
  return days.map(([id, at, status], i) => ({
    id,
    status,
    total: String(250 * (i + 1)),
    currency: 'BDT',
    created_at: at,
    updated_at: at,
    customer: { name: `Order ${i + 1}`, phone: `+880170000000${i + 1}` },
    line_items: [
      { sku: 'SKU-IN-001', name: 'Smoke Return Lifecycle Product', quantity: 1, price: '250' },
    ],
  }));
}

export class ReferenceBridge {
  readonly baseUrl: string;
  private readonly bridgeKey: string;
  private readonly storeId: string;
  private readonly capabilities: Record<string, unknown>;
  private readonly invalidManifest: 'missing-storeId' | 'not-object' | null;
  private readonly supportCategoryMove: boolean;

  private productSeq = 9000;
  private variantSeq = 7000;
  private categorySeq = 100;
  private mediaSeq = 500;
  readonly products = new Map<string, any>();
  readonly productsBySku = new Map<string, string>();
  readonly variants = new Map<string, any[]>(); // productId → variants
  readonly categories = new Map<string, any>();
  readonly mediaByHash = new Map<string, any>();
  readonly mediaById = new Map<string, any>();
  /** P13: productId or `${pid}:${vid}` → { status, quantity? }. */
  readonly stock = new Map<string, { status: string; quantity?: number }>();
  orders: ReferenceBridgeOrder[] = referenceBridgeOrders();
  readonly webhooks: { topic: string; url: string }[] = [];

  constructor(opts: ReferenceBridgeOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://bridge.example.test').replace(/\/+$/, '');
    this.bridgeKey = opts.bridgeKey ?? 'bridge_test_key';
    this.storeId = opts.storeId ?? 'bridge-store-1';
    this.invalidManifest = opts.invalidManifest ?? null;
    this.supportCategoryMove = opts.supportCategoryMove ?? true;
    this.capabilities = {
      ...FULL_CAPABILITIES,
      ...(opts.stockStatusFidelity ? { stockStatusFidelity: opts.stockStatusFidelity } : {}),
      ...(opts.capabilities ?? {}),
    };
  }

  manifest(): Record<string, unknown> {
    return {
      bridge: 'ecomate-bridge/1.0',
      storeId: this.storeId,
      displayName: 'Reference Stub Bridge',
      capabilities: this.capabilities,
      categoryModel: 'custom',
      seoModel: 'native',
      mediaModel: 'url-fetch',
      webhookTopics: ['order.created', 'order.updated', 'product.updated'],
    };
  }

  seedProduct(product: Record<string, unknown>, stock: 'in_stock' | 'out_of_stock' = 'in_stock'): string {
    this.productSeq += 1;
    const id = String(this.productSeq);
    const full: Record<string, unknown> = { status: 'draft', ...product, id };
    this.products.set(id, full);
    if (full.sku) this.productsBySku.set(String(full.sku), id);
    this.stock.set(id, { status: stock });
    return id;
  }

  /** Test seam: read the stored projection (status + optional quantity). */
  stockOf(key: string): { status: string; quantity?: number } | undefined {
    return this.stock.get(key);
  }

  readonly handle: MockHandler = (url, init) => {
    const method = init?.method ?? 'GET';
    const auth = init?.headers?.['Authorization'] ?? init?.headers?.['authorization'];
    if (auth !== `Bearer ${this.bridgeKey}`) {
      return jsonResponse(401, { error: { code: 'unauthorized', message: 'bad bearer' } });
    }
    if (!url.startsWith(this.baseUrl)) {
      return jsonResponse(404, { error: { code: 'not_found', message: 'unknown host' } });
    }
    const path = url.slice(this.baseUrl.length).split('?')[0] ?? '';
    const query = url.includes('?') ? new URLSearchParams(url.slice(url.indexOf('?') + 1)) : new URLSearchParams();
    const body = parseJson(init?.body);

    // ── Manifest (§1) ────────────────────────────────────────────────
    if (path === '/.well-known/ecomate-bridge' && method === 'GET') {
      if (this.invalidManifest === 'not-object') return jsonResponse(200, ['not', 'an', 'object']);
      if (this.invalidManifest === 'missing-storeId') {
        const { storeId: _drop, ...rest } = this.manifest();
        void _drop;
        return jsonResponse(200, rest);
      }
      return jsonResponse(200, this.manifest());
    }

    // ── Products (§3) ────────────────────────────────────────────────
    if (path === '/bridge/v1/products' && method === 'GET') {
      const sku = query.get('sku');
      const limit = Math.min(Number(query.get('limit') ?? '25') || 25, 100);
      const all = [...this.products.values()];
      const filtered = sku ? all.filter((p) => String(p.sku) === sku) : all;
      return jsonResponse(200, { products: filtered.slice(0, limit) });
    }
    if (path === '/bridge/v1/products' && method === 'POST') {
      const sku = body?.sku !== undefined ? String(body.sku) : '';
      // Idempotent create: same SKU → update in place, no duplicate.
      const existingId = sku ? this.productsBySku.get(sku) : undefined;
      if (existingId) {
        const merged = { ...this.products.get(existingId), ...body, id: existingId };
        this.products.set(existingId, merged);
        return jsonResponse(200, { product: merged });
      }
      this.productSeq += 1;
      const id = String(this.productSeq);
      const created: Record<string, unknown> = { status: 'draft', ...body, id };
      this.products.set(id, created);
      if (sku) this.productsBySku.set(sku, id);
      this.stock.set(id, { status: 'in_stock' });
      return jsonResponse(201, { product: created });
    }
    const productMatch = path.match(/^\/bridge\/v1\/products\/([^/]+)$/);
    if (productMatch) {
      const id = decodeURIComponent(productMatch[1]!);
      const current = this.products.get(id);
      if (!current) return jsonResponse(404, { error: { code: 'not_found', message: 'no such product' } });
      if (method === 'GET') return jsonResponse(200, { product: current });
      if (method === 'PUT') {
        if (body?.sku !== undefined && String(body.sku) !== String(current.sku)) {
          if (current.sku) this.productsBySku.delete(String(current.sku));
          this.productsBySku.set(String(body.sku), id);
        }
        const merged = { ...current, ...body, id };
        this.products.set(id, merged);
        return jsonResponse(200, { product: merged });
      }
      if (method === 'DELETE') {
        if (this.capabilities.delete === false) {
          return jsonResponse(422, { error: { code: 'capability_unsupported', message: 'delete disabled' } });
        }
        this.products.delete(id);
        if (current.sku) this.productsBySku.delete(String(current.sku));
        return jsonResponse(200, { ok: true });
      }
    }
    const pubMatch = path.match(/^\/bridge\/v1\/products\/([^/]+)\/publication$/);
    if (pubMatch && method === 'POST') {
      const id = decodeURIComponent(pubMatch[1]!);
      const current = this.products.get(id);
      if (!current) return jsonResponse(404, { error: { code: 'not_found', message: 'no such product' } });
      current.status = body?.state ?? current.status;
      return jsonResponse(200, { ok: true, status: current.status });
    }

    // ── Variants (§3) ────────────────────────────────────────────────
    const variantsMatch = path.match(/^\/bridge\/v1\/products\/([^/]+)\/variants$/);
    if (variantsMatch) {
      const pid = decodeURIComponent(variantsMatch[1]!);
      if (!this.products.get(pid)) {
        return jsonResponse(404, { error: { code: 'not_found', message: 'no such product' } });
      }
      if (method === 'GET') return jsonResponse(200, { variants: this.variants.get(pid) ?? [] });
      if (method === 'POST') {
        this.variantSeq += 1;
        const variant = { id: String(this.variantSeq), ...body };
        this.variants.set(pid, [...(this.variants.get(pid) ?? []), variant]);
        return jsonResponse(201, { variant });
      }
    }
    const variantMatch = path.match(/^\/bridge\/v1\/variants\/([^/]+)$/);
    if (variantMatch && method === 'PUT') {
      const vid = decodeURIComponent(variantMatch[1]!);
      for (const [pid, list] of this.variants) {
        const idx = list.findIndex((v) => String(v.id) === vid);
        if (idx >= 0) {
          list[idx] = { ...list[idx], ...body, id: vid };
          this.variants.set(pid, list);
          return jsonResponse(200, { variant: list[idx] });
        }
      }
      return jsonResponse(404, { error: { code: 'not_found', message: 'no such variant' } });
    }

    // ── Categories (§3) ──────────────────────────────────────────────
    if (path === '/bridge/v1/categories' && method === 'GET') {
      const slug = query.get('slug');
      const parent = query.get('parent');
      const all = [...this.categories.values()];
      const filtered = all.filter(
        (c) =>
          (slug === null || String(c.slug) === slug) &&
          (parent === null || String(c.parent_id ?? '') === parent),
      );
      return jsonResponse(200, { categories: filtered });
    }
    if (path === '/bridge/v1/categories' && method === 'POST') {
      this.categorySeq += 1;
      const category = { id: String(this.categorySeq), ...body };
      this.categories.set(String(category.id), category);
      return jsonResponse(201, { category });
    }
    const categoryMatch = path.match(/^\/bridge\/v1\/categories\/([^/]+)$/);
    if (categoryMatch && method === 'PUT') {
      const id = decodeURIComponent(categoryMatch[1]!);
      const current = this.categories.get(id);
      if (!current) return jsonResponse(404, { error: { code: 'not_found', message: 'no such category' } });
      if (body && 'parent_id' in body && !this.supportCategoryMove) {
        return jsonResponse(422, { error: { code: 'capability_unsupported', message: 'cannot re-parent' } });
      }
      const merged = { ...current, ...body, id };
      this.categories.set(id, merged);
      return jsonResponse(200, { category: merged });
    }

    // ── Media (§3) ───────────────────────────────────────────────────
    if (path === '/bridge/v1/media' && method === 'GET') {
      const hash = query.get('hash');
      const hit = hash ? this.mediaByHash.get(hash) : undefined;
      return jsonResponse(200, { media: hit ? [hit] : [] });
    }
    if (path === '/bridge/v1/media' && method === 'POST') {
      this.mediaSeq += 1;
      const media = { id: `br-media-${this.mediaSeq}`, src: body?.src ?? null, hash: body?.hash ?? null };
      this.mediaById.set(String(media.id), media);
      if (media.hash) this.mediaByHash.set(String(media.hash), media);
      return jsonResponse(201, { media });
    }

    // ── Stock (§4: status + P13 optional quantity) ────────────────────
    const stockMatch = path.match(/^\/bridge\/v1\/products\/([^/]+)\/stock$/);
    if (stockMatch) {
      const id = decodeURIComponent(stockMatch[1]!);
      if (method === 'GET') {
        const cur = this.stock.get(id) ?? { status: 'out_of_stock' };
        return jsonResponse(200, { ...cur });
      }
      if (method === 'PUT') {
        if (this.capabilities.stockStatusFidelity === 'unsupported') {
          return jsonResponse(422, { error: { code: 'capability_unsupported', message: 'stock is monitor-only' } });
        }
        const status = String(body?.status ?? 'out_of_stock');
        const next: { status: string; quantity?: number } = { status };
        // Quantity is stored ONLY when the manifest declared it — an
        // undeclared bridge stays status-only on the wire (P13 default).
        if (this.capabilities.stockQuantity === true && body?.quantity !== undefined) {
          const q = Number(body.quantity);
          if (Number.isFinite(q)) next.quantity = Math.max(0, Math.floor(q));
        }
        this.stock.set(id, next);
        return jsonResponse(200, { ok: true, ...next });
      }
    }
    const varStockMatch = path.match(/^\/bridge\/v1\/products\/([^/]+)\/variants\/([^/]+)\/stock$/);
    if (varStockMatch) {
      const key = `${decodeURIComponent(varStockMatch[1]!)}:${decodeURIComponent(varStockMatch[2]!)}`;
      if (method === 'GET') {
        const cur = this.stock.get(key) ?? { status: 'out_of_stock' };
        return jsonResponse(200, { ...cur });
      }
      if (method === 'PUT') {
        if (this.capabilities.stockStatusFidelity === 'unsupported') {
          return jsonResponse(422, { error: { code: 'capability_unsupported', message: 'stock is monitor-only' } });
        }
        const status = String(body?.status ?? 'out_of_stock');
        const next: { status: string; quantity?: number } = { status };
        if (this.capabilities.stockQuantity === true && body?.quantity !== undefined) {
          const q = Number(body.quantity);
          if (Number.isFinite(q)) next.quantity = Math.max(0, Math.floor(q));
        }
        this.stock.set(key, next);
        return jsonResponse(200, { ok: true, ...next });
      }
    }

    // ── Orders (§5 + §7) ─────────────────────────────────────────────
    if (path === '/bridge/v1/orders' && method === 'GET') {
      const since = query.get('since');
      const until = query.get('until');
      const statusCsv = query.get('status');
      const page = Math.max(Number(query.get('page') ?? '1') || 1, 1);
      const pageSize = Math.min(Math.max(Number(query.get('page_size') ?? '50') || 50, 1), 100);
      const statuses = statusCsv ? new Set(statusCsv.split(',')) : null;
      const filtered = this.orders.filter((o) => {
        if (since && o.created_at < since) return false;
        if (until && o.created_at > until) return false;
        if (statuses && !statuses.has(o.status)) return false;
        return true;
      });
      const start = (page - 1) * pageSize;
      const slice = filtered.slice(start, start + pageSize);
      return jsonResponse(200, { orders: slice, has_more: start + pageSize < filtered.length });
    }
    const orderMatch = path.match(/^\/bridge\/v1\/orders\/([^/]+)$/);
    if (orderMatch && method === 'GET') {
      const id = decodeURIComponent(orderMatch[1]!);
      const order = this.orders.find((o) => o.id === id);
      if (!order) return jsonResponse(404, { error: { code: 'not_found', message: 'no such order' } });
      return jsonResponse(200, { ...order });
    }
    const orderStatusMatch = path.match(/^\/bridge\/v1\/orders\/([^/]+)\/status$/);
    if (orderStatusMatch && method === 'POST') {
      const id = decodeURIComponent(orderStatusMatch[1]!);
      const order = this.orders.find((o) => o.id === id);
      if (!order) return jsonResponse(404, { error: { code: 'not_found', message: 'no such order' } });
      const target = String(body?.target ?? '');
      const allowed = (this.capabilities.orderStatusUpdateTargets as string[] | undefined) ?? ['cancelled', 'completed'];
      if (this.capabilities.orderStatusUpdate === false || !allowed.includes(target)) {
        return jsonResponse(422, { error: { code: 'capability_unsupported', message: `target '${target}' unsupported` } });
      }
      order.status = target;
      return jsonResponse(200, { ok: true, status: order.status });
    }

    // ── Webhooks (§6) ────────────────────────────────────────────────
    if (path === '/bridge/v1/webhooks' && method === 'GET') {
      return jsonResponse(200, { webhooks: this.webhooks });
    }
    if (path === '/bridge/v1/webhooks' && method === 'POST') {
      const topics: string[] = Array.isArray(body?.topics) ? body.topics.map(String) : [];
      for (const topic of topics) {
        if (!this.webhooks.some((w) => w.topic === topic)) {
          this.webhooks.push({ topic, url: String(body?.url ?? '') });
        }
      }
      return jsonResponse(201, { ok: true });
    }

    // Any undocumented path 404s: the adapter must speak only the spec.
    return jsonResponse(404, { error: { code: 'not_found', message: `no such bridge route: ${method} ${path}` } });
  };
}

function parseJson(raw: unknown): any {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
