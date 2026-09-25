/**
 * Central-commerce fixture harness — P2 (§13, P2 row).
 *
 * Shared builders + scripted fixtures + MockFetch consumed by the P2
 * contract suite and later by P4/P9/P10. All data is deterministic
 * (fixed ids, fixed timestamps, no randomness, no latency).
 *
 * Webhook signing delegates to `../webhook-crypto` so fixture signatures
 * and provider verification share one implementation.
 */
import type { FetchFn, ProbeHttpInit, ProbeHttpResponse } from '../base-provider';
import type { StoreWithSecrets } from '../provider.contract';
import {
  signCustomDelivery,
  signShopifyDelivery,
  signWooDelivery,
} from '../webhook-crypto';
import { FakeProvider } from './fake.provider';

export { signCustomDelivery, signShopifyDelivery, signWooDelivery };

// ── Product / variant / media / category fixtures ─────────────────────

export interface FixtureMediaInput {
  src: string;
  hash: string;
}

export interface FixtureVariantInput {
  sku: string;
  name: string;
  price: number;
  salePrice?: number;
  attributes?: Record<string, string>;
}

/** §8.11 Table A field keys, as the fixture product shape. */
export interface FixtureProductInput {
  sku: string;
  name: string;
  shortDescription?: string;
  fullDescription?: string;
  productCode?: string;
  barcode?: string;
  primaryImage?: FixtureMediaInput;
  galleryImages?: FixtureMediaInput[];
  categoryPaths?: string[][];
  brand?: string;
  tags?: string[];
  productType?: 'simple' | 'variable';
  price: number;
  salePrice?: number;
  weight?: number;
  dimensions?: { length: number; width: number; height: number };
  seoTitle?: string;
  seoDescription?: string;
  slug?: string;
  customFields?: Record<string, unknown>;
  variants?: FixtureVariantInput[];
}

let productCounter = 0;

export function buildProductFixture(
  overrides: Partial<FixtureProductInput> & { sku: string },
): FixtureProductInput {
  productCounter += 1;
  const n = productCounter;
  return {
    name: `Fixture Product ${n}`,
    shortDescription: `Short description ${n}`,
    fullDescription: `Full description ${n}`,
    price: 100 + n,
    productType: 'simple',
    slug: `fixture-product-${n}`,
    tags: ['fixture'],
    ...overrides,
  };
}

export function buildVariantFixture(
  overrides: Partial<FixtureVariantInput> & { sku: string },
): FixtureVariantInput {
  return {
    name: `Variant ${overrides.sku}`,
    price: 50,
    attributes: { Size: 'M' },
    ...overrides,
  };
}

export function buildMediaFixture(src: string, hash: string): FixtureMediaInput {
  return { src, hash };
}

export function buildCategoryPathsFixture(): string[][] {
  return [
    ['Clothing', 'Men', 'T-Shirts'],
    ['Clothing', 'Women', 'Dresses'],
  ];
}

// ── Order fixtures ────────────────────────────────────────────────────

export interface FixtureOrderItem {
  sku: string;
  qty: number;
  price: number;
}

export interface FixtureOrder {
  id: string;
  createdAt: string;
  status: string;
  total: number;
  currency: string;
  items: FixtureOrderItem[];
  customer?: { phone?: string; name?: string };
}

/** Five orders, one per day 2026-09-20…24, mixed statuses (window tests). */
export function buildOrderFixtures(): FixtureOrder[] {
  return [
    {
      id: 'ext-order-1',
      createdAt: '2026-09-20T10:00:00.000Z',
      status: 'processing',
      total: 250,
      currency: 'BDT',
      items: [{ sku: 'SKU-IN-001', qty: 1, price: 250 }],
      customer: { phone: '+8801700000001', name: 'Order One' },
    },
    {
      id: 'ext-order-2',
      createdAt: '2026-09-21T11:00:00.000Z',
      status: 'completed',
      total: 500,
      currency: 'BDT',
      items: [{ sku: 'SKU-IN-001', qty: 2, price: 250 }],
      customer: { phone: '+8801700000002', name: 'Order Two' },
    },
    {
      id: 'ext-order-3',
      createdAt: '2026-09-22T12:00:00.000Z',
      status: 'pending',
      total: 150,
      currency: 'BDT',
      items: [{ sku: 'SKU-OUT-001', qty: 1, price: 150 }],
    },
    {
      id: 'ext-order-4',
      createdAt: '2026-09-23T13:00:00.000Z',
      status: 'processing',
      total: 750,
      currency: 'BDT',
      items: [
        { sku: 'SKU-VAR-RED-M', qty: 1, price: 400 },
        { sku: 'SKU-VAR-BLU-L', qty: 1, price: 350 },
      ],
      customer: { phone: '+8801700000004', name: 'Order Four' },
    },
    {
      id: 'ext-order-5',
      createdAt: '2026-09-24T14:00:00.000Z',
      status: 'cancelled',
      total: 99,
      currency: 'BDT',
      items: [{ sku: 'SKU-IN-001', qty: 1, price: 99 }],
    },
  ];
}

// ── Store units (per-kind secrets/settings for probe + webhook tests) ──

export type StoreKind = 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM';

export function buildStoreUnit(
  kind: StoreKind,
  overrides?: Partial<StoreWithSecrets>,
): StoreWithSecrets {
  const base: Record<StoreKind, StoreWithSecrets> = {
    WOOCOMMERCE: {
      id: 'store-woo-1',
      kind: 'WOOCOMMERCE',
      settings: { baseUrl: 'https://woo.example.test' },
      secrets: {
        baseUrl: 'https://woo.example.test',
        consumerKey: 'ck_test_key',
        consumerSecret: 'cs_test_secret',
        webhookSecret: 'wh_woo_secret',
      },
    },
    SHOPIFY: {
      id: 'store-shopify-1',
      kind: 'SHOPIFY',
      settings: { shop: 'test-shop.myshopify.com' },
      secrets: {
        shop: 'test-shop.myshopify.com',
        accessToken: 'shpat_test_token',
        webhookSecret: 'wh_shopify_secret',
      },
    },
    CUSTOM: {
      id: 'store-custom-1',
      kind: 'CUSTOM',
      settings: { baseUrl: 'https://bridge.example.test' },
      secrets: {
        baseUrl: 'https://bridge.example.test',
        bridgeKey: 'bridge_test_key',
        webhookSecret: 'wh_custom_secret',
      },
    },
  };
  const unit = base[kind];
  return {
    ...unit,
    ...overrides,
    settings: { ...(unit.settings ?? {}), ...(overrides?.settings ?? {}) },
    secrets: { ...(unit.secrets ?? {}), ...(overrides?.secrets ?? {}) },
  };
}

// ── MockFetch (injected fetch mock with a call log) ───────────────────

export type MockHandler = (
  url: string,
  init?: ProbeHttpInit,
) => Promise<ProbeHttpResponse> | ProbeHttpResponse;

export interface MockCall {
  url: string;
  init?: ProbeHttpInit;
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): ProbeHttpResponse {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) lower[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  };
}

export function networkError(code = 'ECONNREFUSED'): Error {
  return Object.assign(new Error(`connect ${code} (mock)`), { code });
}

export class MockFetch {
  readonly calls: MockCall[] = [];
  private handlers: { match: (url: string) => boolean; handle: MockHandler }[] =
    [];
  private fallback: MockHandler = () => jsonResponse(404, { message: 'no mock' });

  readonly fetch: FetchFn = async (url, init) => {
    this.calls.push({ url, init });
    const route = this.handlers.find((h) => h.match(url));
    return route ? route.handle(url, init) : this.fallback(url, init);
  };

  onPrefix(prefix: string, handle: MockHandler): this {
    this.handlers.push({ match: (url) => url.startsWith(prefix), handle: this.wrap(handle) });
    return this;
  }

  onAll(handle: MockHandler): this {
    this.handlers.push({ match: () => true, handle: this.wrap(handle) });
    return this;
  }

  setFallback(handle: MockHandler): this {
    this.fallback = this.wrap(handle);
    return this;
  }

  reset(): void {
    this.calls.length = 0;
    this.handlers.length = 0;
  }

  urls(): string[] {
    return this.calls.map((c) => c.url);
  }

  private wrap(handle: MockHandler): MockHandler {
    return (url, init) => handle(url, init);
  }
}

// ── Webhook delivery builders ─────────────────────────────────────────

export interface WebhookDelivery {
  headers: Record<string, string>;
  rawBody: Buffer;
}

export function buildWooDelivery(
  secret: string,
  payload: unknown,
  overrides?: { headers?: Record<string, string>; rawBody?: Buffer },
): WebhookDelivery {
  const rawBody = overrides?.rawBody ?? Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    rawBody,
    headers: {
      'X-WC-Webhook-Signature': signWooDelivery(secret, rawBody),
      'X-WC-Webhook-Delivery-ID': 'woo-delivery-1',
      'X-WC-Webhook-Topic': 'order.created',
      ...(overrides?.headers ?? {}),
    },
  };
}

export function buildShopifyDelivery(
  secret: string,
  payload: unknown,
  overrides?: { headers?: Record<string, string>; rawBody?: Buffer },
): WebhookDelivery {
  const rawBody = overrides?.rawBody ?? Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    rawBody,
    headers: {
      'X-Shopify-Hmac-Sha256': signShopifyDelivery(secret, rawBody),
      'X-Shopify-Webhook-Id': 'shopify-delivery-1',
      'X-Shopify-Topic': 'orders/create',
      ...(overrides?.headers ?? {}),
    },
  };
}

export function buildCustomDelivery(
  secret: string,
  payload: unknown,
  overrides?: { headers?: Record<string, string>; rawBody?: Buffer; timestamp?: string },
): WebhookDelivery {
  const rawBody = overrides?.rawBody ?? Buffer.from(JSON.stringify(payload), 'utf8');
  const deliveryId = 'custom-delivery-1';
  const timestamp =
    overrides?.timestamp ?? String(Math.floor(Date.now() / 1000));
  return {
    rawBody,
    headers: {
      'X-EcoMate-Signature': signCustomDelivery(secret, deliveryId, timestamp, rawBody),
      'X-EcoMate-Delivery-Id': deliveryId,
      'X-EcoMate-Timestamp': timestamp,
      'X-EcoMate-Topic': 'order.created',
      ...(overrides?.headers ?? {}),
    },
  };
}

// ── Fake seeding (scripted fixtures: products, stock, orders, external) ─

export interface FakeSeed {
  inStockSku: string;
  outOfStockSku: string;
  variableSku: string;
  existingExternalSku: string;
}

/**
 * Load the scripted fixture set into a FakeProvider: two simple products
 * (IN_STOCK / OUT_OF_STOCK), one variable product with two variants, five
 * orders across the 2026-09-20…24 window, and one pre-existing external
 * product whose remote values differ (first-contact adopt_existing, P4).
 */
export function seedFakeProvider(fake: FakeProvider): FakeSeed {
  const inStock = buildProductFixture({
    sku: 'SKU-IN-001',
    name: 'Smoke Return Lifecycle Product',
    price: 250,
    slug: 'smoke-return-lifecycle-product',
    categoryPaths: [['Clothing', 'Men', 'T-Shirts']],
    primaryImage: buildMediaFixture(
      'https://cdn.example.test/in-001.jpg',
      'hash-in-001',
    ),
  });
  const outOfStock = buildProductFixture({
    sku: 'SKU-OUT-001',
    name: 'Always Out Product',
    price: 150,
    slug: 'always-out-product',
  });
  const variable = buildProductFixture({
    sku: 'SKU-VAR-001',
    name: 'Variable Tee',
    price: 400,
    productType: 'variable',
    slug: 'variable-tee',
    variants: [
      buildVariantFixture({ sku: 'SKU-VAR-RED-M', name: 'Red / M', price: 400 }),
      buildVariantFixture({ sku: 'SKU-VAR-BLU-L', name: 'Blue / L', price: 350 }),
    ],
  });

  // Pre-existing external product: remote-only values differ from EcoMate.
  const existingExternal = buildProductFixture({
    sku: 'EXT-001',
    name: 'External Store Name (differs)',
    price: 999,
    slug: 'external-store-name',
  });

  const refs = {
    inStock: { providerId: 'fake-prod-in-001' },
    outOfStock: { providerId: 'fake-prod-out-001' },
    variable: { providerId: 'fake-prod-var-001' },
    existingExternal: { providerId: 'fake-prod-ext-001' },
  };

  fake.directSeed(refs.inStock.providerId, { ...inStock }, 'IN_STOCK', 'published');
  fake.directSeed(refs.outOfStock.providerId, { ...outOfStock }, 'OUT_OF_STOCK', 'published');
  fake.directSeed(refs.variable.providerId, { ...variable }, 'IN_STOCK', 'published', [
    buildVariantFixture({ sku: 'SKU-VAR-RED-M', name: 'Red / M', price: 400 }),
    buildVariantFixture({ sku: 'SKU-VAR-BLU-L', name: 'Blue / L', price: 350 }),
  ]);
  fake.directSeed(
    refs.existingExternal.providerId,
    { ...existingExternal },
    'IN_STOCK',
    'published',
  );

  for (const order of buildOrderFixtures()) {
    fake.directSeedOrder({ ...order });
  }

  return {
    inStockSku: 'SKU-IN-001',
    outOfStockSku: 'SKU-OUT-001',
    variableSku: 'SKU-VAR-001',
    existingExternalSku: 'EXT-001',
  };
}
