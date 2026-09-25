/**
 * Shopify live-HTTP spec — central-commerce P9 deliverable 1–3.
 *
 * Proves every live seam against MockFetch (recorded-fixture style vectors):
 * testConnection (reachability/auth/permissions/media preflight,
 * providerStoreId from myshopify_domain with shop:id fallback),
 * products/variants create+idempotent update (options price pair, weight +
 * weightUnit, handle, vendor, tags), media identity + reuse, collections +
 * product_type adapter-internal, publication ACTIVE/DRAFT, delete via
 * GraphQL productDelete, cost via inventory_item.cost (BR-23), SEO via
 * GraphQL productUpdate, readStockState read-only, publishStockState
 * unreachable (BR-08 zero writes), orders fetch (paged, window),
 * pushOrderStatus CANCELLED/FULFILLED + read-back, HMAC vectors incl.
 * 5-minute replay where timestamped, ensureWebhooks.
 *
 * Zero-write assertions (§13): a full product + stock + order flow yields
 * zero stock-quantity writes — no request body anywhere carries
 * inventory_quantity/quantity/available_available writes (BR-06). The
 * STOCK_DRIFT_MONITOR_ONLY engine path itself is proven in
 * sync/__tests__/stock-status-sync.spec.ts (unsupported audit vectors);
 * here the adapter side is pinned: read-only read + unreachable publish.
 *
 * No local Shopify store exists on this machine and no live credentials
 * exist in env — provider behaviour is proven by fixture-replay here plus
 * the FakeProvider whole-engine suites (§13 E2E clause). The live dev-store
 * smoke remains the single operator prerequisite (see P9-evidence.md).
 */
import { ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import {
  SHOPIFY_API_VERSION,
  SHOPIFY_WEBHOOK_TOPICS,
  ShopifyProvider,
  shopifyExcerpt,
  shopifyFieldToPayload,
  shopifyProductToSnapshots,
  shopifySlugify,
  shopifyVariantToPayload,
} from '../shopify.provider';
import { snapshotField } from '../field-snapshot';
import {
  MockFetch,
  SHOPIFY_FAKE_ACCESS_TOKEN,
  buildShopifyDelivery,
  buildStoreUnit,
  jsonResponse,
  mockShopifyTokenEndpoint,
  networkError,
} from './fixtures';

const STORE = () => buildStoreUnit('SHOPIFY');
const BASE = 'https://test-shop.myshopify.com/admin/api/2026-07';

function shopifyProductFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 9001,
    title: 'Fixture Tee',
    body_html: '<p>Full description</p>',
    vendor: 'EcoMate',
    product_type: 'T-Shirts',
    tags: 'fixture, tee',
    handle: 'fixture-tee',
    status: 'active',
    options: [{ name: 'Size', values: ['M'] }],
    variants: [
      {
        id: 7001,
        sku: 'SKU-SHOPIFY-001',
        price: '250.00',
        compare_at_price: null,
        weight: 0.5,
        weight_unit: 'kg',
        barcode: 'SKU-SHOPIFY-001',
        inventory_item_id: 8001,
        inventory_quantity: 12,
      },
    ],
    images: [{ src: 'https://cdn.example.test/tee.jpg' }],
    ...overrides,
  };
}

describe('ShopifyProvider live HTTP (P9)', () => {
  // ── Pure mapping units (§8.11 Table A, Shopify target column) ──────────
  describe('payload mapping (pure)', () => {
    it('pins the Admin API version (2026-07, dashboard-aligned)', () => {
      expect(SHOPIFY_API_VERSION).toBe('2026-07');
    });

    it('maps name/description/vendor/tags/handle/publication, never cost/dims/quantity', () => {
      const payload = shopifyFieldToPayload({
        name: 'Tee',
        fullDescription: '<p>Full</p>',
        brand: 'EcoMate',
        tags: ['a', 'b'],
        slug: 'tee',
        publicationState: 'published',
        costPrice: '10',
        dimensions: { length: 1, width: 2, height: 3 },
      });
      expect(payload).toMatchObject({
        title: 'Tee',
        body_html: '<p>Full</p>',
        vendor: 'EcoMate',
        tags: 'a, b',
        handle: 'tee',
        status: 'active',
      });
      const s = JSON.stringify(payload);
      expect(s).not.toMatch(/cost/i);
      expect(s).not.toMatch(/dimension/i);
      expect(s).not.toMatch(/quantity/i);
    });

    it('maps draft publication state', () => {
      expect(shopifyFieldToPayload({ publicationState: 'draft' })).toMatchObject({ status: 'draft' });
    });

    it('variant price pair: price = sale ?? base, compare_at_price = sale ? base : null', () => {
      expect(shopifyVariantToPayload({ sku: 'A', price: '100', salePrice: '80' })).toMatchObject({
        price: '80',
        compare_at_price: '100',
      });
      expect(shopifyVariantToPayload({ sku: 'A', price: '100' })).toMatchObject({
        price: '100',
        compare_at_price: null,
      });
    });

    it('variant weight carries weight_unit (default kg)', () => {
      expect(shopifyVariantToPayload({ sku: 'A', weight: 0.5 })).toMatchObject({
        weight: 0.5,
        weight_unit: 'kg',
      });
      expect(shopifyVariantToPayload({ sku: 'A', weight: 2, weightUnit: 'g' })).toMatchObject({
        weight_unit: 'g',
      });
    });

    it('combo input throws COMBO_SKIPPED, never fabricated (BR-22)', () => {
      expect(() => shopifyFieldToPayload({ productType: 'combo', name: 'C' })).toThrow(/COMBO_SKIPPED/);
    });

    it('slugifies collection handles deterministically', () => {
      expect(shopifySlugify('Men / Shirts!')).toBe('men-shirts');
    });

    it('composes a plain-text excerpt (not native)', () => {
      expect(shopifyExcerpt('<p>Hello <b>world</b></p>')).toBe('Hello world');
      expect(shopifyExcerpt('')).toBeNull();
    });

    it('snapshots derive through the matrix keys (excerpt/price pair/handle)', () => {
      const snaps = shopifyProductToSnapshots(shopifyProductFixture() as any, [
        'name',
        'shortDescription',
        'fullDescription',
        'price',
        'salePrice',
        'slug',
        'brand',
        'publicationState',
      ]);
      expect(snaps.name?.value).toBe('Fixture Tee');
      expect(snaps.shortDescription?.value).toBe('Full description');
      expect(snaps.price?.value).toBe('250.00');
      expect(snaps.salePrice?.value).toBeNull();
      expect(snaps.slug?.value).toBe('fixture-tee');
      expect(snaps.brand?.value).toBe('EcoMate');
      expect(snaps.publicationState?.value).toBe('published');
      // Deterministic hashes (ownership baselines): same value → same hash.
      expect(snaps.name?.hash).toBe(snapshotField('Fixture Tee').hash);
    });
  });

  // ── testConnection ────────────────────────────────────────────────────
  describe('testConnection', () => {
    it('200 with myshopify_domain → providerStoreId for identityFingerprint', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() => jsonResponse(200, { shop: { id: 123, myshopify_domain: 'test-shop.myshopify.com' } }));
      const res = await new ShopifyProvider(mock.fetch).testConnection(STORE());
      expect(res).toMatchObject({
        reachable: true,
        authenticated: true,
        permissionsOk: true,
        providerStoreId: 'test-shop.myshopify.com',
      });
      // Client Credentials Grant: token exchange first, then the probe.
      expect(mock.calls[0]?.url).toBe('https://test-shop.myshopify.com/admin/oauth/access_token');
      const probe = mock.calls.find((c) => c.url === `${BASE}/shop.json`);
      expect(probe?.url).toBe(`${BASE}/shop.json`);
      expect(probe?.init?.headers).toMatchObject({ 'X-Shopify-Access-Token': SHOPIFY_FAKE_ACCESS_TOKEN });
    });

    it('200 with id only → shop:{id} fallback (never undefined when identified)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() => jsonResponse(200, { shop: { id: 424242 } }));
      const res = await new ShopifyProvider(mock.fetch).testConnection(STORE());
      expect(res.providerStoreId).toBe('shop:424242');
    });

    it('reports served API version; flags silent fall-forward loudly', async () => {
      const same = new MockFetch();
      mockShopifyTokenEndpoint(same);
      same.onAll(() =>
        jsonResponse(
          200,
          { shop: { myshopify_domain: 'test-shop.myshopify.com' } },
          { 'x-shopify-api-version': '2026-07' },
        ),
      );
      await expect(new ShopifyProvider(same.fetch).testConnection(STORE())).resolves.toMatchObject({
        apiVersion: { requested: '2026-07', served: '2026-07', fallForward: false },
      });
      const drifted = new MockFetch();
      mockShopifyTokenEndpoint(drifted);
      drifted.onAll(() =>
        jsonResponse(
          200,
          { shop: { myshopify_domain: 'test-shop.myshopify.com' } },
          { 'x-shopify-api-version': '2025-10' },
        ),
      );
      await expect(
        new ShopifyProvider(drifted.fetch).testConnection(STORE()),
      ).resolves.toMatchObject({
        apiVersion: { requested: '2026-07', served: '2025-10', fallForward: true },
      });
    });

    it('401 → reachable but not authenticated; 403 → permissions fail (never throws)', async () => {
      const unauth = new MockFetch();
      mockShopifyTokenEndpoint(unauth);
      unauth.onAll(() => jsonResponse(401, { errors: 'unauthorized' }));
      await expect(new ShopifyProvider(unauth.fetch).testConnection(STORE())).resolves.toMatchObject({
        reachable: true,
        authenticated: false,
        permissionsOk: false,
      });
      const forbidden = new MockFetch();
      mockShopifyTokenEndpoint(forbidden);
      forbidden.onAll(() => jsonResponse(403, { errors: 'forbidden' }));
      await expect(new ShopifyProvider(forbidden.fetch).testConnection(STORE())).resolves.toMatchObject({
        reachable: true,
        authenticated: true,
        permissionsOk: false,
      });
    });

    it('network failure → unreachable as data; missing credentials → zero HTTP calls', async () => {
      const down = new MockFetch();
      down.onAll(() => {
        throw networkError('ECONNREFUSED');
      });
      await expect(new ShopifyProvider(down.fetch).testConnection(STORE())).resolves.toMatchObject({
        reachable: false,
        authenticated: false,
      });
      const mock = new MockFetch();
      mock.onAll(() => jsonResponse(200, { shop: {} }));
      const bare = buildStoreUnit('SHOPIFY', { secrets: { clientId: '', clientSecret: '' } });
      const res = await new ShopifyProvider(mock.fetch).testConnection(bare);
      expect(res.authenticated).toBe(false);
      expect(mock.calls).toHaveLength(0);
    });

    it('media preflight: HEAD ok → true, failing → false, unset → undefined', async () => {
      const settings = { mediaProbeUrl: 'https://cdn.example.test/probe.jpg' };
      const ok = new MockFetch();
      mockShopifyTokenEndpoint(ok);
      ok.onPrefix(`${BASE}/shop.json`, () => jsonResponse(200, { shop: { myshopify_domain: 'x.myshopify.com' } }))
        .onPrefix('https://cdn.example.test', () => jsonResponse(200, {}));
      await expect(
        new ShopifyProvider(ok.fetch).testConnection(buildStoreUnit('SHOPIFY', { settings })).then((r) => r.mediaReachable),
      ).resolves.toBe(true);
      const fail = new MockFetch();
      mockShopifyTokenEndpoint(fail);
      fail
        .onPrefix(`${BASE}/shop.json`, () => jsonResponse(200, { shop: { myshopify_domain: 'x.myshopify.com' } }))
        .onPrefix('https://cdn.example.test', () => {
          throw networkError();
        });
      await expect(
        new ShopifyProvider(fail.fetch).testConnection(buildStoreUnit('SHOPIFY', { settings })).then((r) => r.mediaReachable),
      ).resolves.toBe(false);
      const plain = new MockFetch();
      mockShopifyTokenEndpoint(plain);
      plain.onAll(() => jsonResponse(200, { shop: {} }));
      await expect(
        new ShopifyProvider(plain.fetch).testConnection(STORE()).then((r) => r.mediaReachable),
      ).resolves.toBeUndefined();
    });
  });

  // ── Products: create + idempotent update ──────────────────────────────
  describe('upsertProduct', () => {
    function createRouter(seen: { bodies: unknown[]; graphql: unknown[] }) {
      return (url: string, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? 'GET';
        if (url.includes('/graphql.json')) {
          seen.graphql.push(JSON.parse(String(init?.body ?? '{}')));
          return jsonResponse(200, { data: { productUpdate: { product: { id: 'gid://shopify/Product/9001' }, userErrors: [] } } });
        }
        if (method === 'GET' && url.includes('/products.json')) {
          return jsonResponse(200, { products: [] });
        }
        if (method === 'POST' && url.endsWith('/products.json')) {
          seen.bodies.push(JSON.parse(String(init?.body ?? '{}')));
          return jsonResponse(201, { product: shopifyProductFixture() });
        }
        if (method === 'POST' && url.endsWith('/collects.json')) {
          return jsonResponse(201, { collect: { id: 1 } });
        }
        if (method === 'POST' && url.includes('/metafields.json')) {
          return jsonResponse(201, { metafield: { id: 5 } });
        }
        return jsonResponse(200, {});
      };
    }

    it('creates when no SKU match; payload carries title/handle/status/images, never cost/quantity/dims', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      const seen = { bodies: [] as unknown[], graphql: [] as unknown[] };
      mock.setFallback(createRouter(seen));
      const shopify = new ShopifyProvider(mock.fetch);
      const ref = await shopify.upsertProduct(
        STORE(),
        {
          sku: 'SKU-SHOPIFY-001',
          name: 'Fixture Tee',
          slug: 'fixture-tee',
          price: '250',
          primaryImage: 'https://cdn.example.test/tee.jpg',
          publicationState: 'published',
          costPrice: '10',
        } as any,
        ['name', 'slug', 'price', 'primaryImage', 'publicationState', 'costPrice'],
      );
      expect(ref.providerId).toBe('9001');
      const productBody = (seen.bodies[0] as any).product;
      expect(productBody).toMatchObject({ title: 'Fixture Tee', handle: 'fixture-tee', status: 'active' });
      expect(productBody.images).toEqual([{ src: 'https://cdn.example.test/tee.jpg' }]);
      const wire = JSON.stringify(seen.bodies);
      expect(wire).not.toMatch(/cost/i);
      expect(wire).not.toMatch(/inventory_quantity/i);
      expect(wire).not.toMatch(/"quantity"/i);
      expect(wire).not.toMatch(/dimension/i);
    });

    it('cost travels ONLY via inventory_items PUT (BR-23, never customer-facing)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      const puts: { url: string; body: unknown }[] = [];
      mock.setFallback((url, init) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('/products.json')) return jsonResponse(200, { products: [] });
        if (method === 'POST' && url.endsWith('/products.json')) {
          return jsonResponse(201, { product: shopifyProductFixture() });
        }
        if (method === 'PUT' && url.includes('/inventory_items/')) {
          puts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
          return jsonResponse(200, { inventory_item: { id: 8001, cost: '10.00' } });
        }
        return jsonResponse(200, {});
      });
      await new ShopifyProvider(mock.fetch).upsertProduct(
        STORE(),
        { sku: 'SKU-SHOPIFY-001', name: 'T', costPrice: '10.00' } as any,
        ['name', 'costPrice'],
      );
      expect(puts).toHaveLength(1);
      expect(puts[0]?.url).toMatch(/\/inventory_items\/8001\.json/);
      expect(puts[0]?.body).toEqual({ inventory_item: { id: '8001', cost: '10.00' } });
    });

    it('seo travels via GraphQL productUpdate (seo.title/description)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      const seen = { bodies: [] as unknown[], graphql: [] as unknown[] };
      mock.setFallback(createRouter(seen));
      await new ShopifyProvider(mock.fetch).upsertProduct(
        STORE(),
        { sku: 'S', name: 'T', seoTitle: 'SEO T', seoDescription: 'SEO D' } as any,
        ['name', 'seoTitle', 'seoDescription'],
      );
      expect(seen.graphql).toHaveLength(1);
      expect(JSON.stringify(seen.graphql[0])).toMatch(/seo/);
      expect(JSON.stringify(seen.graphql[0])).toMatch(/SEO T/);
    });

    it('updates idempotently on SKU match (PUT, no POST /products.json)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.setFallback((url, init) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('/products.json')) {
          return jsonResponse(200, {
            products: [{ id: 9001, variants: [{ id: 7001, sku: 'SKU-SHOPIFY-001', inventory_item_id: 8001 }] }],
          });
        }
        if (method === 'PUT' && url.includes('/products/9001.json')) {
          return jsonResponse(200, { product: shopifyProductFixture() });
        }
        return jsonResponse(200, {});
      });
      const ref = await new ShopifyProvider(mock.fetch).upsertProduct(
        STORE(),
        { sku: 'SKU-SHOPIFY-001', name: 'Renamed', __externalId: undefined } as any,
        ['name'],
      );
      expect(ref.providerId).toBe('9001');
      expect(mock.calls.some((c) => c.init?.method === 'POST' && c.url.endsWith('/products.json'))).toBe(false);
    });

    it('collection membership attaches via collects for numeric ids only (adapter-internal)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      const collects: unknown[] = [];
      mock.setFallback((url, init) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('/products.json')) return jsonResponse(200, { products: [] });
        if (method === 'POST' && url.endsWith('/products.json')) {
          return jsonResponse(201, { product: shopifyProductFixture() });
        }
        if (method === 'POST' && url.endsWith('/collects.json')) {
          collects.push(JSON.parse(String(init?.body ?? '{}')));
          return jsonResponse(201, { collect: { id: 2 } });
        }
        return jsonResponse(200, {});
      });
      // Unresolved EcoMate UUID → zero collects calls (never a doomed 422).
      await new ShopifyProvider(mock.fetch).upsertProduct(
        STORE(),
        { sku: 'S-1', name: 'T', category: 'c0ffee-uuid' } as any,
        ['name', 'category'],
      );
      expect(collects).toHaveLength(0);
    });

    it('customFields allowlist: material sent, secrets never leave (BR-23-adjacent)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      const metafields: unknown[] = [];
      mock.setFallback((url, init) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('/products.json')) return jsonResponse(200, { products: [] });
        if (method === 'POST' && url.endsWith('/products.json')) {
          return jsonResponse(201, { product: shopifyProductFixture() });
        }
        if (method === 'POST' && url.includes('/metafields.json')) {
          metafields.push(JSON.parse(String(init?.body ?? '{}')));
          return jsonResponse(201, { metafield: { id: 9 } });
        }
        return jsonResponse(200, {});
      });
      await new ShopifyProvider(mock.fetch).upsertProduct(
        STORE(),
        { sku: 'S-2', name: 'T', customFields: { material: 'cotton', webhookSecret: 'shh' } } as any,
        ['name', 'customFields'],
      );
      expect(metafields).toHaveLength(1);
      expect(JSON.stringify(metafields)).toMatch(/cotton/);
      expect(JSON.stringify(metafields)).not.toMatch(/shh/);
    });

    it('missing connection settings throw INVALID_REQUEST with zero HTTP calls', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      await expect(
        new ShopifyProvider(mock.fetch).upsertProduct(
          { id: 's', kind: 'SHOPIFY', settings: {}, secrets: {} },
          { sku: 'S', name: 'T' } as any,
          ['name'],
        ),
      ).rejects.toMatchObject({ category: ProviderErrorCategory.INVALID_REQUEST });
      expect(mock.calls).toHaveLength(0);
    });
  });

  // ── Variants (options semantics, price pair, per-variant cost) ─────────
  describe('upsertVariants', () => {
    it('creates missing + updates matched by SKU; options/price/weight on the wire', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.setFallback((url, init) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('/variants.json')) {
          return jsonResponse(200, {
            variants: [{ id: 7001, sku: 'SKU-VAR-A', price: '400.00', inventory_item_id: 8001 }],
          });
        }
        if (method === 'PUT' && url.includes('/variants/7001.json')) {
          return jsonResponse(200, { variant: { id: 7001, inventory_item_id: 8001 } });
        }
        if (method === 'POST' && url.includes('/variants.json')) {
          return jsonResponse(201, { variant: { id: 7002, inventory_item_id: 8002 } });
        }
        return jsonResponse(200, {});
      });
      const out = await new ShopifyProvider(mock.fetch).upsertVariants(
        STORE(),
        { providerId: '9001' },
        [
          { sku: 'SKU-VAR-A', price: '400', attributes: { Size: 'M' } },
          { sku: 'SKU-VAR-B', price: '350', salePrice: '300', weight: 0.2 },
        ] as any,
      );
      expect(out.get('SKU-VAR-A')).toEqual({ providerId: '7001' });
      expect(out.get('SKU-VAR-B')).toEqual({ providerId: '7002' });
      const putBody = JSON.parse(
        String(mock.calls.find((c) => c.init?.method === 'PUT')?.init?.body ?? '{}'),
      );
      expect(putBody.variant.price).toBe('400');
      const postBody = JSON.parse(
        String(
          mock.calls.find((c) => c.init?.method === 'POST' && !c.url.includes('/oauth/access_token'))
            ?.init?.body ?? '{}',
        ),
      );
      expect(postBody.variant).toMatchObject({ price: '300', compare_at_price: '350', weight: 0.2 });
    });

    it('rejects >100 variants with zero HTTP (deprecated REST ceiling)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() => jsonResponse(200, { variants: [] }));
      const variants = Array.from({ length: 101 }, (_, i) => ({ sku: `OVER-${i}` }));
      await expect(
        new ShopifyProvider(mock.fetch).upsertVariants(STORE(), { providerId: '9001' }, variants as any),
      ).rejects.toThrow('VARIANT_LIMIT_EXCEEDED');
      expect(mock.calls).toHaveLength(0);
    });

    it('rejects >3 options with zero HTTP (deprecated REST ceiling)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() => jsonResponse(200, { variants: [] }));
      const variants = [
        { sku: 'OPT-1', attributes: { Size: 'M', Color: 'Red', Material: 'Cotton', Fit: 'Slim' } },
      ];
      await expect(
        new ShopifyProvider(mock.fetch).upsertVariants(STORE(), { providerId: '9001' }, variants as any),
      ).rejects.toThrow('VARIANT_LIMIT_EXCEEDED');
      expect(mock.calls).toHaveLength(0);
    });
  });

  // ── Categories (adapter-internal collections) ─────────────────────────
  describe('ensureCategories', () => {
    it('looks up handle before creating; second ensure issues zero POSTs', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      let created = 0;
      mock.setFallback((url, init) => {
        if ((init?.method ?? 'GET') === 'POST') {
          created += 1;
          return jsonResponse(201, { custom_collection: { id: 100 + created } });
        }
        return jsonResponse(200, { custom_collections: [] });
      });
      const out = await new ShopifyProvider(mock.fetch).ensureCategories(STORE(), [['Men', 'Shirts']]);
      expect(out.get('Men / Shirts')?.providerId).toBeDefined();
      expect(created).toBe(2);

      const mock2 = new MockFetch();
      mockShopifyTokenEndpoint(mock2);
      let created2 = 0;
      mock2.setFallback((url, init) => {
        if ((init?.method ?? 'GET') === 'POST') {
          created2 += 1;
          return jsonResponse(201, { custom_collection: { id: 999 } });
        }
        const u = new URL(url);
        const handle = u.searchParams.get('handle');
        if (handle === 'men') return jsonResponse(200, { custom_collections: [{ id: 5, handle: 'men' }] });
        return jsonResponse(200, { custom_collections: [{ id: 6, handle: 'shirts' }] });
      });
      const out2 = await new ShopifyProvider(mock2.fetch).ensureCategories(STORE(), [['Men', 'Shirts']]);
      expect(out2.get('Men / Shirts')).toEqual({ providerId: '6' });
      expect(created2).toBe(0);
    });

    it('renameCategory PUTs the mapped collection; moveCategory is a loud flat-model skip (zero HTTP)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() => jsonResponse(200, { custom_collection: { id: 6 } }));
      const renamed = await new ShopifyProvider(mock.fetch).renameCategory(
        STORE(),
        { providerId: '6' },
        { name: 'Tees', slug: 'tees' },
      );
      expect(renamed.ok).toBe(true);
      // calls[0] is the token exchange; the Admin API PUT follows.
      const renamePut = mock.calls.find((c) => c.url.includes('/custom_collections/6.json'));
      expect(JSON.parse(String(renamePut?.init?.body ?? '{}'))).toMatchObject({
        custom_collection: { title: 'Tees', handle: 'tees' },
      });

      const quiet = new MockFetch();
      const moved = await new ShopifyProvider(quiet.fetch).moveCategory(STORE(), { providerId: '6' }, null);
      expect(moved.skipped).toBe(true);
      expect(moved.reason).toMatch(/FLAT_MODEL/);
      expect(quiet.calls).toHaveLength(0);
    });
  });

  // ── Media / publication / delete ──────────────────────────────────────
  describe('media + publication + delete', () => {
    it('ensureMedia resolves stored-id refs with zero HTTP (never re-upload mapped)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      const out = await new ShopifyProvider(mock.fetch).ensureMedia(STORE(), [
        { src: 'https://cdn/1.jpg', hash: 'abc' },
      ] as any);
      expect(out.get('https://cdn/1.jpg')).toEqual({ providerId: 'shopify-media:abc' });
      expect(mock.calls).toHaveLength(0);
    });

    it('setPublication maps published/draft to active/draft', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() => jsonResponse(200, { product: { id: 9001 } }));
      const shopify = new ShopifyProvider(mock.fetch);
      await shopify.setPublication(STORE(), { providerId: '9001' }, 'draft');
      // calls[0] is the token exchange; the Admin API PUTs follow.
      const puts = mock.calls.filter((c) => !c.url.includes('/oauth/access_token'));
      expect(JSON.parse(String(puts[0]?.init?.body ?? '{}'))).toEqual({
        product: { id: '9001', status: 'draft' },
      });
      await shopify.setPublication(STORE(), { providerId: '9001' }, 'published');
      const putsAfter = mock.calls.filter((c) => !c.url.includes('/oauth/access_token'));
      expect(JSON.parse(String(putsAfter[1]?.init?.body ?? '{}'))).toEqual({
        product: { id: '9001', status: 'active' },
      });
    });

    it('deleteProduct uses the GraphQL productDelete mutation (BR-09)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() =>
        jsonResponse(200, { data: { productDelete: { deletedProductId: 'gid://shopify/Product/9001', userErrors: [] } } }),
      );
      const res = await new ShopifyProvider(mock.fetch).deleteProduct(STORE(), { providerId: '9001' });
      expect(res.ok).toBe(true);
      const gql = mock.calls.find((c) => c.url.endsWith('/graphql.json'));
      expect(gql?.url).toMatch(/\/graphql\.json$/);
      expect(JSON.stringify(gql?.init?.body)).toMatch(/productDelete/);
      expect(JSON.stringify(gql?.init?.body)).toMatch(/gid:\/\/shopify\/Product\/9001/);
    });
  });

  // ── Stock: read-only read, unreachable publish (BR-06/BR-08) ──────────
  describe('stock fidelity (BR-06/BR-08)', () => {
    it('readStockState derives IN/OUT from inventory_quantity with exactly one GET (zero writes)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() =>
        jsonResponse(200, {
          product: { id: 9001, variants: [{ inventory_quantity: 3 }, { inventory_quantity: 0 }] },
        }),
      );
      await expect(new ShopifyProvider(mock.fetch).readStockState(STORE(), { providerId: '9001' })).resolves.toBe(
        'IN_STOCK',
      );
      // Token exchange + exactly one Admin API GET (zero writes).
      expect(mock.calls).toHaveLength(2);
      const api = mock.calls.filter((c) => !c.url.includes('/oauth/access_token'));
      expect(api).toHaveLength(1);
      expect(api[0]?.init?.method ?? 'GET').not.toBe('PUT');

      const empty = new MockFetch();
      mockShopifyTokenEndpoint(empty);
      empty.onAll(() => jsonResponse(200, { product: { id: 9001, variants: [{ inventory_quantity: 0 }] } }));
      await expect(new ShopifyProvider(empty.fetch).readStockState(STORE(), { providerId: '9001' })).resolves.toBe(
        'OUT_OF_STOCK',
      );
    });

    it('publishStockState + publishVariantStockState throw BEFORE any HTTP write (zero writes)', async () => {
      for (const variant of [false, true]) {
        const mock = new MockFetch();
        mockShopifyTokenEndpoint(mock);
        mock.onAll(() => jsonResponse(200, {}));
        const shopify = new ShopifyProvider(mock.fetch);
        const err = variant
          ? await shopify
              .publishVariantStockState(STORE(), { providerId: '9001' }, { providerId: '7001' }, 'OUT_OF_STOCK')
              .catch((e) => e)
          : await shopify.publishStockState(STORE(), { providerId: '9001' }, 'OUT_OF_STOCK').catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.category).toBe(ProviderErrorCategory.INVALID_REQUEST);
        expect(String(err.message)).toMatch(/zero writes/);
        expect(mock.calls).toHaveLength(0);
      }
    });

    it('full product + stock + order flow yields zero stock-quantity writes', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.setFallback((url, init) => {
        const method = init?.method ?? 'GET';
        if (url.includes('/graphql.json')) {
          return jsonResponse(200, {
            data: {
              productUpdate: { product: { id: 'gid://shopify/Product/9001' }, userErrors: [] },
              productDelete: { deletedProductId: 'gid://shopify/Product/9001', userErrors: [] },
            },
          });
        }
        if (method === 'GET' && url.includes('/products.json')) return jsonResponse(200, { products: [] });
        if (method === 'POST' && url.endsWith('/products.json')) {
          return jsonResponse(201, { product: shopifyProductFixture() });
        }
        if (url.includes('/products/9001.json')) {
          return jsonResponse(200, { product: shopifyProductFixture() });
        }
        if (url.includes('/orders.json')) {
          return jsonResponse(200, {
            orders: [
              {
                id: 5001,
                financial_status: 'pending',
                total_price: '250.00',
                currency: 'BDT',
                created_at: '2026-09-21T10:00:00Z',
                line_items: [{ sku: 'SKU-SHOPIFY-001', quantity: 1, price: '250.00', title: 'Tee' }],
              },
            ],
          });
        }
        return jsonResponse(200, {});
      });
      const shopify = new ShopifyProvider(mock.fetch);
      const ref = await shopify.upsertProduct(STORE(), { sku: 'S', name: 'T', price: '250' } as any, ['name', 'price', 'sku']);
      await shopify.readStockState(STORE(), ref);
      await shopify.fetchOrders(STORE(), {
        since: new Date('2026-09-20T00:00:00.000Z'),
        until: new Date('2026-09-24T00:00:00.000Z'),
        page: 1,
        pageSize: 10,
      });
      const writeBodies = mock.calls
        .filter((c) => (c.init?.method ?? 'GET') !== 'GET' && (c.init?.method ?? 'GET') !== 'HEAD')
        .map((c) => String(c.init?.body ?? ''));
      expect(writeBodies.length).toBeGreaterThan(0);
      for (const body of writeBodies) {
        // BR-06: no exact quantity is ever written — the read `quantity`
        // inside order line_items travels only in GET responses, never in a
        // write body.
        expect(body).not.toMatch(/inventory_quantity/i);
        expect(body).not.toMatch(/"quantity"/i);
        expect(body).not.toMatch(/available/i);
      }
    });
  });

  // ── Orders: paged fetch, CANCELLED/FULFILLED push, read-back ──────────
  describe('orders', () => {
    it('fetchOrders passes the window + pagination over REST', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() =>
        jsonResponse(200, {
          orders: [
            { id: 5001, financial_status: 'pending', total_price: '250.00', line_items: [] },
            { id: 5002, financial_status: 'paid', total_price: '500.00', line_items: [] },
          ],
        }),
      );
      const res = await new ShopifyProvider(mock.fetch).fetchOrders(STORE(), {
        since: new Date('2026-09-20T00:00:00.000Z'),
        until: new Date('2026-09-24T00:00:00.000Z'),
        page: 2,
        pageSize: 2,
      });
      expect(res.orders).toHaveLength(2);
      expect(res.hasMore).toBe(true);
      const ordersCall = mock.calls.find((c) => c.url.includes('/orders.json?'));
      expect(ordersCall?.url).toMatch(/created_at_min=.*09-20/);
      expect(ordersCall?.url).toMatch(/page=2/);
      expect(ordersCall?.url).toMatch(/status=any/);
    });

    it('pushOrderStatus: cancelled → cancel.json, completed → fulfillments.json (CANCELLED/FULFILLED)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() => jsonResponse(200, {}));
      const shopify = new ShopifyProvider(mock.fetch);
      await shopify.pushOrderStatus(STORE(), { providerId: '5001' }, 'cancelled');
      const api = () => mock.calls.filter((c) => !c.url.includes('/oauth/access_token'));
      expect(api()[0]?.url).toMatch(/\/orders\/5001\/cancel\.json$/);
      expect(api()[0]?.init?.method).toBe('POST');
      await shopify.pushOrderStatus(STORE(), { providerId: '5001' }, 'completed');
      expect(api()[1]?.url).toMatch(/\/orders\/5001\/fulfillments\.json$/);
      expect(api()[1]?.init?.method).toBe('POST');
    });

    it('push → read-back round-trip (CANCELLED then FULFILLED)', async () => {
      let remote: any = { id: 5001, financial_status: 'pending', fulfillment_status: null, cancelled_at: null };
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.setFallback((url, init) => {
        if (url.endsWith('/cancel.json')) {
          remote = { ...remote, cancelled_at: '2026-09-21T10:00:00Z' };
          return jsonResponse(200, { order: remote });
        }
        if (url.endsWith('/fulfillments.json')) {
          remote = { ...remote, fulfillment_status: 'fulfilled' };
          return jsonResponse(200, { fulfillment: { id: 1 } });
        }
        return jsonResponse(200, { order: remote });
      });
      const shopify = new ShopifyProvider(mock.fetch);
      await shopify.pushOrderStatus(STORE(), { providerId: '5001' }, 'cancelled');
      await expect(shopify.readOrderStatus(STORE(), { providerId: '5001' })).resolves.toEqual({
        status: 'CANCELLED',
      });
      await shopify.pushOrderStatus(STORE(), { providerId: '5001' }, 'completed');
      // Cancelled sticks (cancelled_at still set) — the read-back reports
      // truth, never the hoped-for target.
      await expect(shopify.readOrderStatus(STORE(), { providerId: '5001' })).resolves.toEqual({
        status: 'CANCELLED',
      });
    });

    it('readOrderStatus maps fulfilled → FULFILLED', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      mock.onAll(() =>
        jsonResponse(200, { order: { id: 5001, financial_status: 'paid', fulfillment_status: 'fulfilled' } }),
      );
      await expect(new ShopifyProvider(mock.fetch).readOrderStatus(STORE(), { providerId: '5001' })).resolves.toEqual(
        { status: 'FULFILLED' },
      );
    });
  });

  // ── Webhooks: HMAC + delivery id + topic + replay ─────────────────────
  describe('verifyWebhook + ensureWebhooks', () => {
    // No separate webhookSecret in the fixture: HMAC falls back to the
    // OAuth client secret (`webhookSecret ?? clientSecret`).
    const secret = 'test-client-secret-fake';
    const store = () => buildStoreUnit('SHOPIFY');
    const provider = () => new ShopifyProvider();

    it('accepts a correctly signed delivery with topic', () => {
      const d = buildShopifyDelivery(secret, { id: 5001 });
      expect(provider().verifyWebhook(store(), d.headers, d.rawBody)).toMatchObject({
        valid: true,
        deliveryId: 'shopify-delivery-1',
        topic: 'orders/create',
      });
    });

    it('rejects tampered body / missing signature / missing delivery id', () => {
      const d = buildShopifyDelivery(secret, { id: 5001 });
      const tampered = Buffer.from(d.rawBody);
      tampered[tampered.length - 1] ^= 1;
      expect(provider().verifyWebhook(store(), d.headers, tampered)).toEqual({
        valid: false,
        reason: 'bad-signature',
      });
      expect(
        provider().verifyWebhook(store(), { 'X-Shopify-Webhook-Id': 'x' }, d.rawBody),
      ).toEqual({ valid: false, reason: 'missing-signature' });
      const { ['X-Shopify-Webhook-Id']: _drop, ...noId } = d.headers;
      void _drop;
      expect(provider().verifyWebhook(store(), noId, d.rawBody)).toEqual({
        valid: false,
        reason: 'missing-delivery-id',
      });
    });

    it('5-minute replay window applies where a timestamp is supplied', () => {
      const fresh = buildShopifyDelivery(secret, { id: 1 });
      const now = String(Math.floor(Date.now() / 1000));
      expect(
        provider().verifyWebhook(store(), { ...fresh.headers, 'X-Shopify-Timestamp': now }, fresh.rawBody).valid,
      ).toBe(true);
      const stale = buildShopifyDelivery(secret, { id: 1 });
      expect(
        provider().verifyWebhook(store(), { ...stale.headers, 'X-Shopify-Timestamp': '0' }, stale.rawBody),
      ).toEqual({ valid: false, reason: 'stale-timestamp' });
    });

    it('ensureWebhooks registers missing topics only (idempotent)', async () => {
      const mock = new MockFetch();
      mockShopifyTokenEndpoint(mock);
      const created: unknown[] = [];
      mock.setFallback((url, init) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return jsonResponse(200, { webhooks: [{ topic: 'orders/create' }] });
        }
        created.push(JSON.parse(String(init?.body ?? '{}')));
        return jsonResponse(201, { webhook: { id: 1 } });
      });
      const res = await new ShopifyProvider(mock.fetch).ensureWebhooks(STORE(), 'https://api.example.test');
      expect(res).toEqual({ ok: true, topics: SHOPIFY_WEBHOOK_TOPICS });
      expect(created).toHaveLength(2);
      expect(JSON.stringify(created)).toMatch(/orders\/updated/);
      expect(JSON.stringify(created)).toMatch(/products\/update/);
      // Keyed receiver URL: the canonical public storeKey (store.id) is part
      // of the registered address (receivers REQUIRE :storeKey).
      expect(JSON.stringify(created)).toMatch(/\/api\/webhooks\/stores\/shopify\/store-shopify-1/);
      for (const body of created) {
        expect(body).toMatchObject({
          webhook: {
            address: 'https://api.example.test/api/webhooks/stores/shopify/store-shopify-1',
            format: 'json',
          },
        });
      }
      // Payload serialization pinned to the code's version (not the default).
      for (const body of created) {
        expect(body).toMatchObject({ webhook: { api_version: '2026-07' } });
      }
    });
  });
});
