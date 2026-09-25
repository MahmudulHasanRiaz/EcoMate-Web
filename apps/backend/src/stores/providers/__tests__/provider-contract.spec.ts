/**
 * Provider contract suite — central-commerce P2 (§13, P2 row).
 *
 * The multi-provider guarantee: the gate every provider must satisfy. Run
 * against the in-memory deterministic `FakeProvider` (full contract) and
 * each real adapter with an injected `MockFetch` (live seams:
 * testConnection, verifyWebhook, the BR-08 fidelity gate; P4/P9/P10 live
 * methods run against MockFetch, and any still-stubbed method must fail
 * LOUD via the named notImplemented error, never silently).
 *
 * Vectors (§13): capability completeness, connection-failure taxonomy,
 * idempotent upsert, media reuse, publication transitions, stock fidelity
 * (faithful never receives a quantity — BR-06; unsupported receives ZERO
 * writes — BR-08), order pagination + window boundaries, webhook
 * accept/reject vectors, retry classification (§8.1).
 *
 * The §8.11 field-subset gate lives here too: every adapter's
 * `syncedFields` MUST be a subset of the Table A matrix (a field absent
 * from the matrix cannot be synced). P4 owns the per-field behaviour
 * matrix (Table B).
 *
 * Shared harness: all fixtures/builders come from `./fixtures` — the same
 * harness P4/P9/P10 consume.
 */
import { ProviderError, ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import type { CommerceProvider, ProviderCapabilities, StoreWithSecrets } from '../provider.contract';
import { BaseCommerceProvider, type FetchFn } from '../base-provider';
import { WooCommerceProvider } from '../woocommerce.provider';
import { ShopifyProvider } from '../shopify.provider';
import { CustomBridgeProvider } from '../custom-bridge.provider';
import {
  MAX_SYNC_ATTEMPTS,
  RETRY_BACKOFF_MS,
  classifyHttpStatus,
  classifyProviderError,
} from '../retry-classifier';
import { FakeProvider } from './fake.provider';
import { ReferenceBridge } from './reference-bridge';
import {
  MockFetch,
  buildCategoryPathsFixture,
  buildCustomDelivery,
  buildMediaFixture,
  buildProductFixture,
  buildShopifyDelivery,
  buildStoreUnit,
  buildVariantFixture,
  buildWooDelivery,
  jsonResponse,
  networkError,
  seedFakeProvider,
} from './fixtures';

// ── §8.11 Table A matrix field keys (the syncable universe) ──────────────
// Row order follows the plan: name(1) shortDescription(2) fullDescription(3)
// sku(4) productCode(5) barcode(6) primaryImage(7) galleryImages(8)
// category(9) brand(10) tags(11) productType(12) variants(13)
// variantAttributes(14) price(15) salePrice(16) costPrice(17) weight(18)
// dimensions(19) seoTitle(20) seoDescription(21) slug(22)
// publicationState(23) customFields(24). Inventory is a separate subsystem
// (BR-06) and is NOT a matrix field.
const MATRIX_FIELDS = [
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
  'dimensions',
  'seoTitle',
  'seoDescription',
  'slug',
  'publicationState',
  'customFields',
] as const;

function makeFake(): FakeProvider {
  return new FakeProvider();
}

function seededFake(): { fake: FakeProvider; store: StoreWithSecrets } {
  const fake = makeFake();
  seedFakeProvider(fake);
  return { fake, store: buildStoreUnit('CUSTOM') };
}

describe('provider contract suite (P2 §13)', () => {
  // ── Capability declaration completeness ──────────────────────────────
  describe('capability declaration completeness', () => {
    const subjects: Array<[string, () => CommerceProvider]> = [
      ['fake', makeFake],
      ['woocommerce', () => new WooCommerceProvider()],
      ['shopify', () => new ShopifyProvider()],
      ['custom', () => new CustomBridgeProvider()],
    ];

    it.each(subjects.map(([name]) => name))(
      '%s declares every ProviderCapabilities key with the right shape',
      (name) => {
        const provider = subjects.find(([n]) => n === name)![1]();
        const caps: ProviderCapabilities = provider.declaredCapabilities;
        const boolKeys = [
          'products',
          'variations',
          'variantDelete',
          'categories',
          'media',
          'mediaReuse',
          'delete',
          'seo',
          'costPrice',
          'weight',
          'dimensions',
          'slug',
          'orders',
          'webhooks',
          'orderStatusUpdate',
          'contactCheckExposure',
          'combos',
        ] as const;
        for (const key of boolKeys) {
          expect(typeof caps[key]).toBe('boolean');
        }
        expect(Array.isArray(caps.orderStatusUpdateTargets)).toBe(true);
        expect(['faithful', 'unsupported']).toContain(caps.stockStatusFidelity);
        expect(['taxonomy', 'collection', 'custom', 'unsupported']).toContain(
          caps.categoryModel,
        );
        expect(['native', 'plugin-meta', 'unsupported']).toContain(caps.seoModel);
        expect(['url-fetch', 'binary-upload', 'unsupported']).toContain(caps.mediaModel);
        expect(['plugin', 'inferred']).toContain(caps.externalEditsDetectable);
      },
    );

    it.each(subjects.map(([name]) => name))(
      '%s declares combos=false (BR-22: never fabricated)',
      (name) => {
        const provider = subjects.find(([n]) => n === name)![1]();
        expect(provider.declaredCapabilities.combos).toBe(false);
      },
    );

    it('locks the §7.1 stock-fidelity matrix (BR-06/BR-08)', () => {
      expect(new WooCommerceProvider().declaredCapabilities.stockStatusFidelity).toBe(
        'faithful',
      );
      expect(new ShopifyProvider().declaredCapabilities.stockStatusFidelity).toBe(
        'unsupported',
      );
      expect(new CustomBridgeProvider().declaredCapabilities.stockStatusFidelity).toBe(
        'faithful',
      );
      expect(makeFake().declaredCapabilities.stockStatusFidelity).toBe('faithful');
    });

    it('requires non-empty orderStatusUpdateTargets wherever status push is declared', () => {
      for (const make of subjects.map(([, m]) => m)) {
        const caps = make().declaredCapabilities;
        if (caps.orderStatusUpdate) {
          expect(caps.orderStatusUpdateTargets.length).toBeGreaterThan(0);
        }
      }
    });
  });

  // ── §8.11 field-subset gate ───────────────────────────────────────────
  describe('syncedFields ⊆ §8.11 Table A matrix', () => {
    const subjects: Array<[string, () => CommerceProvider & { syncedFields?: string[] }]> = [
      ['fake', makeFake],
      ['woocommerce', () => new WooCommerceProvider()],
      ['shopify', () => new ShopifyProvider()],
      ['custom', () => new CustomBridgeProvider()],
    ];
    const matrix = new Set<string>(MATRIX_FIELDS);

    it.each(subjects.map(([name]) => name))('%s syncs a subset of the matrix', (name) => {
      const provider = subjects.find(([n]) => n === name)![1]();
      const fields = provider.syncedFields ?? [];
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        expect(matrix.has(field)).toBe(true);
      }
      expect(new Set(fields).size).toBe(fields.length); // no duplicates
    });

    it('documents the capability-driven exclusions', () => {
      const woo = new WooCommerceProvider().syncedFields ?? [];
      // BR-23: no native cost field → never pushed; seo is plugin-only (seo:false).
      expect(woo).not.toContain('costPrice');
      expect(woo).not.toContain('seoTitle');
      expect(woo).not.toContain('seoDescription');
      const shopify = new ShopifyProvider().syncedFields ?? [];
      // Dimensions are not native on Shopify → skipped with reason.
      expect(shopify).not.toContain('dimensions');
      // inventory_item.cost exists (never customer-facing — BR-23).
      expect(shopify).toContain('costPrice');
      const custom = new CustomBridgeProvider().syncedFields ?? [];
      // Manifest may enable cost in P10; safe default excludes it.
      expect(custom).not.toContain('costPrice');
    });
  });

  // ── resolveCapabilities ───────────────────────────────────────────────
  describe('resolveCapabilities', () => {
    it('returns an equal-but-detached copy of the declaration (Fake)', async () => {
      const fake = makeFake();
      const caps = await fake.resolveCapabilities(buildStoreUnit('CUSTOM'));
      expect(caps).toEqual(fake.declaredCapabilities);
      expect(caps).not.toBe(fake.declaredCapabilities);
    });

    it('WooCommerce/Shopify return the static declaration (P4+ negotiates live for plugin/app specifics)', async () => {
      const store = buildStoreUnit('WOOCOMMERCE');
      for (const provider of [new WooCommerceProvider(), new ShopifyProvider()]) {
        await expect(provider.resolveCapabilities(store)).resolves.toEqual(
          provider.declaredCapabilities,
        );
      }
    });

    it('Custom resolves the live manifest; unreachable falls back to declared (never throws)', async () => {
      const bridge = new ReferenceBridge();
      const mock = new MockFetch();
      mock.onPrefix(bridge.baseUrl, bridge.handle);
      const live = await new CustomBridgeProvider(mock.fetch).resolveCapabilities(
        buildStoreUnit('CUSTOM'),
      );
      expect(live.stockStatusFidelity).toBe('faithful');
      expect(live.combos).toBe(false);
      const down = new MockFetch();
      down.onAll(() => {
        throw networkError('ECONNREFUSED');
      });
      await expect(
        new CustomBridgeProvider(down.fetch).resolveCapabilities(buildStoreUnit('CUSTOM')),
      ).resolves.toEqual(new CustomBridgeProvider().declaredCapabilities);
    });
  });

  // ── Connection-failure taxonomy ───────────────────────────────────────
  describe('connection-failure taxonomy', () => {
    it('Fake reports reachable + authenticated + permissionsOk', async () => {
      const { fake, store } = seededFake();
      const res = await fake.testConnection(store);
      expect(res.reachable).toBe(true);
      expect(res.authenticated).toBe(true);
      expect(res.permissionsOk).toBe(true);
      expect(res.providerStoreId).toBe('fake-store-1');
      expect(res.capabilities).toEqual(fake.declaredCapabilities);
    });

    describe.each([
      {
        slug: 'woocommerce',
        make: (fetchFn: FetchFn) => new WooCommerceProvider(fetchFn),
        store: () => buildStoreUnit('WOOCOMMERCE'),
        okBody: { settings: { site_url: 'https://shop.example.test' } },
        okId: 'https://shop.example.test',
        missingSecrets: { consumerKey: '', consumerSecret: '' },
      },
      {
        slug: 'shopify',
        make: (fetchFn: FetchFn) => new ShopifyProvider(fetchFn),
        store: () => buildStoreUnit('SHOPIFY'),
        okBody: { shop: { myshopify_domain: 'test-shop.myshopify.com' } },
        okId: 'test-shop.myshopify.com',
        missingSecrets: { accessToken: '' },
      },
      {
        slug: 'custom',
        make: (fetchFn: FetchFn) => new CustomBridgeProvider(fetchFn),
        store: () => buildStoreUnit('CUSTOM'),
        okBody: { storeId: 'bridge-store-1' },
        okId: 'bridge-store-1',
        missingSecrets: { bridgeKey: '' },
      },
    ])('$slug', ({ make, store, okBody, okId, missingSecrets }) => {
      it('200 → reachable + authenticated + permissionsOk + providerStoreId', async () => {
        const mock = new MockFetch();
        mock.onAll(() => jsonResponse(200, okBody));
        const res = await make(mock.fetch).testConnection(store());
        expect(res).toMatchObject({
          reachable: true,
          authenticated: true,
          permissionsOk: true,
          providerStoreId: okId,
        });
        expect(mock.calls).toHaveLength(1);
      });

      it('401 → reachable but not authenticated (never a throw)', async () => {
        const mock = new MockFetch();
        mock.onAll(() => jsonResponse(401, { message: 'unauthorized' }));
        const res = await make(mock.fetch).testConnection(store());
        expect(res.reachable).toBe(true);
        expect(res.authenticated).toBe(false);
        expect(res.permissionsOk).toBe(false);
      });

      it('403 → authenticated but not permissionsOk', async () => {
        const mock = new MockFetch();
        mock.onAll(() => jsonResponse(403, { message: 'forbidden' }));
        const res = await make(mock.fetch).testConnection(store());
        expect(res.reachable).toBe(true);
        expect(res.authenticated).toBe(true);
        expect(res.permissionsOk).toBe(false);
      });

      it('500 → reachable but not authenticated', async () => {
        const mock = new MockFetch();
        mock.onAll(() => jsonResponse(500, { message: 'boom' }));
        const res = await make(mock.fetch).testConnection(store());
        expect(res.reachable).toBe(true);
        expect(res.authenticated).toBe(false);
        expect(res.permissionsOk).toBe(false);
      });

      it('network failure → unreachable as data, never a throw', async () => {
        const mock = new MockFetch();
        mock.onAll(() => {
          throw networkError('ECONNREFUSED');
        });
        const res = await make(mock.fetch).testConnection(store());
        expect(res).toMatchObject({
          reachable: false,
          authenticated: false,
          permissionsOk: false,
        });
      });

      it('missing credentials → unreachable with zero HTTP calls', async () => {
        const mock = new MockFetch();
        mock.onAll(() => jsonResponse(200, okBody));
        const bare = { ...store(), secrets: { ...store().secrets, ...missingSecrets } };
        const res = await make(mock.fetch).testConnection(bare);
        expect(res).toMatchObject({
          reachable: false,
          authenticated: false,
          permissionsOk: false,
        });
        expect(mock.calls).toHaveLength(0);
      });
    });

    it('WooCommerce media preflight: HEAD ok → true, failing → false, unset → undefined', async () => {
      const settings = { mediaProbeUrl: 'https://cdn.example.test/probe.jpg' };
      const okMock = new MockFetch();
      okMock
        .onPrefix('https://woo.example.test', () =>
          jsonResponse(200, { settings: { site_url: 'https://shop.example.test' } }),
        )
        .onPrefix('https://cdn.example.test', () => jsonResponse(200, {}));
      const okRes = await new WooCommerceProvider(okMock.fetch).testConnection(
        buildStoreUnit('WOOCOMMERCE', { settings }),
      );
      expect(okRes.mediaReachable).toBe(true);

      const failMock = new MockFetch();
      failMock
        .onPrefix('https://woo.example.test', () =>
          jsonResponse(200, { settings: { site_url: 'https://shop.example.test' } }),
        )
        .onPrefix('https://cdn.example.test', () => {
          throw networkError();
        });
      const failRes = await new WooCommerceProvider(failMock.fetch).testConnection(
        buildStoreUnit('WOOCOMMERCE', { settings }),
      );
      expect(failRes.mediaReachable).toBe(false);

      const plainMock = new MockFetch();
      plainMock.onAll(() => jsonResponse(200, { settings: {} }));
      const plainRes = await new WooCommerceProvider(plainMock.fetch).testConnection(
        buildStoreUnit('WOOCOMMERCE'),
      );
      expect(plainRes.mediaReachable).toBeUndefined();
    });
  });

  // ── Idempotent product upsert (Fake) ──────────────────────────────────
  describe('idempotent product upsert (Fake)', () => {
    it('creates on first upsert and returns a stable ref', async () => {
      const { fake, store } = seededFake();
      const before = fake.productCount();
      const input = buildProductFixture({ sku: 'SKU-P2-001', price: 250 });
      const ref = await fake.upsertProduct(store, { ...input }, ['name', 'price', 'sku']);
      expect(ref.providerId).toMatch(/^fake-prod-/);
      expect(fake.productCount()).toBe(before + 1);
      expect(fake.findBySku('SKU-P2-001')?.ref).toEqual(ref);
    });

    it('same sku twice → same ref, no duplicate, field-scoped write only', async () => {
      const { fake, store } = seededFake();
      const first = buildProductFixture({ sku: 'SKU-P2-002', name: 'Original', price: 100 });
      const ref1 = await fake.upsertProduct(store, { ...first }, ['name', 'price', 'sku']);
      const count = fake.productCount();
      const second = { ...first, name: 'Renamed', price: 999 };
      const ref2 = await fake.upsertProduct(store, second, ['name']);
      expect(ref2).toEqual(ref1);
      expect(fake.productCount()).toBe(count);
      const record = fake.getProduct(ref1.providerId);
      expect(record?.fields.name).toBe('Renamed');
      // `price` was NOT in the field list → untouched by the second upsert.
      expect(record?.fields.price).toBe(100);
    });

    it('missing/empty sku → INVALID_REQUEST (a product without SKU cannot be distributed)', async () => {
      const { fake, store } = seededFake();
      await expect(
        fake.upsertProduct(store, { name: 'No SKU' }, ['name']),
      ).rejects.toMatchObject({ category: ProviderErrorCategory.INVALID_REQUEST });
    });

    it('readProductFields returns stable per-field hashes (ownership baselines, P3/P4)', async () => {
      const { fake, store } = seededFake();
      const input = buildProductFixture({ sku: 'SKU-P2-003', name: 'Hash Me', price: 10 });
      const ref = await fake.upsertProduct(store, { ...input }, ['name', 'price', 'sku']);
      const a = await fake.readProductFields(store, ref, ['name', 'price']);
      const b = await fake.readProductFields(store, ref, ['name', 'price']);
      expect(a.name.hash).toBe(b.name.hash);
      expect(a.price.hash).toBe(b.price.hash);
      expect(a.name.hash).not.toBe(a.price.hash);
    });

    it('readProductFields on an unknown ref → REMOTE_NOT_FOUND', async () => {
      const { fake, store } = seededFake();
      await expect(
        fake.readProductFields(store, { providerId: 'fake-prod-ghost' }, ['name']),
      ).rejects.toMatchObject({ category: ProviderErrorCategory.REMOTE_NOT_FOUND });
    });

    it('variants upsert maps each sku stably; categories resolve idempotently', async () => {
      const { fake, store } = seededFake();
      const ref = await fake.upsertProduct(
        store,
        { ...buildProductFixture({ sku: 'SKU-P2-VAR', productType: 'variable' }) },
        ['name', 'sku'],
      );
      const variants = [
        { ...buildVariantFixture({ sku: 'SKU-P2-VAR-A' }) },
        { ...buildVariantFixture({ sku: 'SKU-P2-VAR-B' }) },
      ];
      const map1 = await fake.upsertVariants(store, ref, variants);
      const map2 = await fake.upsertVariants(store, ref, variants);
      expect(map1.get('SKU-P2-VAR-A')).toEqual(map2.get('SKU-P2-VAR-A'));
      expect(map1.get('SKU-P2-VAR-B')).toEqual(map2.get('SKU-P2-VAR-B'));

      const paths = buildCategoryPathsFixture();
      const cats1 = await fake.ensureCategories(store, paths);
      const cats2 = await fake.ensureCategories(store, paths);
      expect([...cats1.values()]).toEqual([...cats2.values()]);
    });
  });

  // ── Media reuse (Fake) ────────────────────────────────────────────────
  describe('media reuse (Fake)', () => {
    it('same hash twice → same ref with exactly one upload', async () => {
      const { fake, store } = seededFake();
      const media = buildMediaFixture('https://cdn.example.test/a.jpg', 'hash-reuse-1');
      const first = await fake.ensureMedia(store, [{ ...media }]);
      const second = await fake.ensureMedia(store, [
        { src: 'https://cdn.example.test/a-renamed.jpg', hash: 'hash-reuse-1' },
      ]);
      expect(second.get('https://cdn.example.test/a-renamed.jpg')).toEqual(
        first.get('https://cdn.example.test/a.jpg'),
      );
      expect(fake.uploads.filter((u) => u.hash === 'hash-reuse-1')).toHaveLength(1);
    });

    it('new hash → new ref and a new upload', async () => {
      const { fake, store } = seededFake();
      const a = await fake.ensureMedia(store, [
        { ...buildMediaFixture('https://cdn.example.test/a.jpg', 'hash-a') },
      ]);
      const b = await fake.ensureMedia(store, [
        { ...buildMediaFixture('https://cdn.example.test/b.jpg', 'hash-b') },
      ]);
      expect(b.get('https://cdn.example.test/b.jpg')).not.toEqual(
        a.get('https://cdn.example.test/a.jpg'),
      );
      expect(fake.uploads).toHaveLength(2);
    });
  });

  // ── Publication + deletion lifecycle (Fake) ───────────────────────────
  describe('publication + deletion lifecycle (Fake)', () => {
    it('draft → published → draft transitions stick', async () => {
      const { fake, store } = seededFake();
      const ref = await fake.upsertProduct(
        store,
        { ...buildProductFixture({ sku: 'SKU-P2-PUB' }) },
        ['name', 'sku'],
      );
      await fake.setPublication(store, ref, 'published');
      expect(fake.getProduct(ref.providerId)).toMatchObject({ publication: 'published' });
      await fake.setPublication(store, ref, 'draft');
      expect(fake.getProduct(ref.providerId)).toMatchObject({ publication: 'draft' });
    });

    it('setPublication on an unknown ref → REMOTE_NOT_FOUND', async () => {
      const { fake, store } = seededFake();
      await expect(
        fake.setPublication(store, { providerId: 'fake-prod-ghost' }, 'published'),
      ).rejects.toMatchObject({ category: ProviderErrorCategory.REMOTE_NOT_FOUND });
    });

    it('delete removes the product; a second delete → REMOTE_NOT_FOUND', async () => {
      const { fake, store } = seededFake();
      const ref = await fake.upsertProduct(
        store,
        { ...buildProductFixture({ sku: 'SKU-P2-DEL' }) },
        ['name', 'sku'],
      );
      await expect(fake.deleteProduct(store, ref)).resolves.toMatchObject({ ok: true });
      expect(fake.findBySku('SKU-P2-DEL')).toBeUndefined();
      await expect(fake.deleteProduct(store, ref)).rejects.toMatchObject({
        category: ProviderErrorCategory.REMOTE_NOT_FOUND,
      });
    });
  });

  // ── Stock fidelity (BR-06/BR-08) ──────────────────────────────────────
  describe('stock fidelity (BR-06/BR-08)', () => {
    it('faithful Fake: status-only push, read-back verifies, detail carries NO quantity', async () => {
      const { fake, store } = seededFake();
      const ref = await fake.upsertProduct(
        store,
        { ...buildProductFixture({ sku: 'SKU-P2-STOCK' }) },
        ['name', 'sku'],
      );
      await fake.publishStockState(store, ref, 'OUT_OF_STOCK');
      await expect(fake.readStockState(store, ref)).resolves.toBe('OUT_OF_STOCK');
      await fake.publishStockState(store, ref, 'IN_STOCK');
      await expect(fake.readStockState(store, ref)).resolves.toBe('IN_STOCK');

      const pushes = fake.calls.filter((c) => c.method === 'publishStockState');
      expect(pushes.length).toBeGreaterThan(0);
      for (const push of pushes) {
        // BR-06: no exact quantity is ever written — the detail is { ref, state } only.
        expect(Object.keys(push.detail).sort()).toEqual(['ref', 'state']);
      }
      expect(JSON.stringify(fake.calls)).not.toMatch(/"quantity"/);
    });

    it('unsupported Shopify: publishStockState throws BEFORE any HTTP write (zero writes)', async () => {
      const mock = new MockFetch();
      mock.onAll(() => jsonResponse(200, {}));
      const shopify = new ShopifyProvider(mock.fetch);
      const store = buildStoreUnit('SHOPIFY');
      const err = await shopify
        .publishStockState(store, { providerId: 'shopify-prod-1' }, 'OUT_OF_STOCK')
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.category).toBe(ProviderErrorCategory.INVALID_REQUEST);
      expect(String(err.message)).toMatch(/zero writes/);
      expect(mock.calls).toHaveLength(0);
    });

    it('WooCommerce P4: faithful publishStockState writes status-only (BR-06)', async () => {
      const mock = new MockFetch();
      mock.onAll(() => jsonResponse(200, { id: 55, stock_status: 'outofstock' }));
      const woo = new WooCommerceProvider(mock.fetch);
      const store = buildStoreUnit('WOOCOMMERCE');
      const res = await woo.publishStockState(store, { providerId: '55' }, 'OUT_OF_STOCK');
      expect(res.ok).toBe(true);
      expect(mock.calls).toHaveLength(1);
      const body = JSON.parse(String(mock.calls[0]?.init?.body ?? '{}'));
      expect(body).toEqual({ stock_status: 'outofstock' });
      expect(JSON.stringify(body)).not.toMatch(/quantity/i);
    });

    it('Custom bridge P10: faithful publishes status-only; unsupported receives ZERO writes', async () => {
      const bridge = new ReferenceBridge();
      const mock = new MockFetch();
      mock.onPrefix(bridge.baseUrl, bridge.handle);
      const custom = new CustomBridgeProvider(mock.fetch);
      const store = buildStoreUnit('CUSTOM');
      const ref = await custom.upsertProduct(store, { sku: 'SKU-CT-001', name: 'T' } as any, [
        'name',
        'sku',
      ]);
      mock.calls.length = 0;
      await custom.publishStockState(store, ref, 'OUT_OF_STOCK');
      await expect(custom.readStockState(store, ref)).resolves.toBe('OUT_OF_STOCK');
      const puts = mock.calls.filter((c) => c.init?.method === 'PUT');
      expect(puts).toHaveLength(1);
      expect(JSON.parse(String(puts[0]?.init?.body ?? '{}'))).toEqual({
        status: 'out_of_stock',
      });

      const narrowBridge = new ReferenceBridge({ stockStatusFidelity: 'unsupported' });
      const narrowMock = new MockFetch();
      narrowMock.onPrefix(narrowBridge.baseUrl, narrowBridge.handle);
      const narrow = new CustomBridgeProvider(narrowMock.fetch);
      const err = await narrow
        .publishStockState(store, { providerId: 'bridge-prod-1' }, 'OUT_OF_STOCK')
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.category).toBe(ProviderErrorCategory.INVALID_REQUEST);
      expect(String(err.message)).toMatch(/zero writes/);
      expect(narrowMock.calls.filter((c) => (c.init?.method ?? 'GET') !== 'GET')).toHaveLength(0);
    });

    it('BaseCommerceProvider exposes the fetch seam for P4/P9/P10 reuse', () => {
      const mock = new MockFetch();
      const provider = new WooCommerceProvider(mock.fetch);
      expect(provider).toBeInstanceOf(BaseCommerceProvider);
      const other = new MockFetch();
      provider.setFetchFn(other.fetch);
      // Seeded orders on the Fake prove the harness side; here the seam swap is the assertion.
      expect((provider as unknown as { fetchFn: unknown }).fetchFn).toBe(other.fetch);
    });
  });

  // ── Order pagination + window boundaries (Fake) ───────────────────────
  describe('order pagination + window boundaries (Fake)', () => {
    const window = {
      since: new Date('2026-09-20T00:00:00.000Z'),
      until: new Date('2026-09-24T23:59:59.999Z'),
    };

    it('pages 1-based across the full window (5 orders, pageSize 2 → 2/2/1)', async () => {
      const { fake, store } = seededFake();
      const p1 = await fake.fetchOrders(store, { ...window, page: 1, pageSize: 2 });
      const p2 = await fake.fetchOrders(store, { ...window, page: 2, pageSize: 2 });
      const p3 = await fake.fetchOrders(store, { ...window, page: 3, pageSize: 2 });
      expect(p1.orders.map((o) => (o as unknown as { id: string }).id)).toEqual([
        'ext-order-1',
        'ext-order-2',
      ]);
      expect(p1.hasMore).toBe(true);
      expect(p2.orders.map((o) => (o as unknown as { id: string }).id)).toEqual([
        'ext-order-3',
        'ext-order-4',
      ]);
      expect(p2.hasMore).toBe(true);
      expect(p3.orders.map((o) => (o as unknown as { id: string }).id)).toEqual([
        'ext-order-5',
      ]);
      expect(p3.hasMore).toBe(false);
    });

    it('window edges are inclusive on both sides', async () => {
      const { fake, store } = seededFake();
      const res = await fake.fetchOrders(store, {
        since: new Date('2026-09-20T10:00:00.000Z'), // exactly order-1
        until: new Date('2026-09-24T14:00:00.000Z'), // exactly order-5
        page: 1,
        pageSize: 10,
      });
      expect(res.orders).toHaveLength(5);
      expect(res.hasMore).toBe(false);
    });

    it('status filter narrows; empty window returns nothing', async () => {
      const { fake, store } = seededFake();
      const filtered = await fake.fetchOrders(store, {
        ...window,
        status: ['processing'],
        page: 1,
        pageSize: 10,
      });
      expect(
        filtered.orders.map((o) => (o as unknown as { id: string }).id).sort(),
      ).toEqual(['ext-order-1', 'ext-order-4']);

      const empty = await fake.fetchOrders(store, {
        since: new Date('2026-09-25T00:00:00.000Z'),
        until: new Date('2026-09-28T00:00:00.000Z'),
        page: 1,
        pageSize: 10,
      });
      expect(empty.orders).toEqual([]);
      expect(empty.hasMore).toBe(false);
    });

    it('WooCommerce P4: fetchOrders pages live (P6 owns ingest worker)', async () => {
      const mock = new MockFetch();
      mock.onAll(() => jsonResponse(200, [{ id: 1, status: 'processing' }]));
      const woo = new WooCommerceProvider(mock.fetch);
      const res = await woo.fetchOrders(buildStoreUnit('WOOCOMMERCE'), {
        ...window,
        page: 1,
        pageSize: 10,
      });
      expect(res.orders).toHaveLength(1);
      expect(mock.urls()[0]).toMatch(/\/orders\?/);
    });

    it('Shopify P9: fetchOrders pages live over REST (P6 owns ingest worker)', async () => {
      const mock = new MockFetch();
      mock.onAll(() => jsonResponse(200, { orders: [{ id: 5001, financial_status: 'pending' }] }));
      const shopify = new ShopifyProvider(mock.fetch);
      const res = await shopify.fetchOrders(buildStoreUnit('SHOPIFY'), {
        ...window,
        page: 1,
        pageSize: 10,
      });
      expect(res.orders).toHaveLength(1);
      expect(mock.urls()[0]).toMatch(/\/orders\.json\?/);
    });

    it('Custom bridge P10: fetchOrders pages live over /bridge/v1/orders (P6 owns ingest worker)', async () => {
      const bridge = new ReferenceBridge();
      const mock = new MockFetch();
      mock.onPrefix(bridge.baseUrl, bridge.handle);
      const custom = new CustomBridgeProvider(mock.fetch);
      const res = await custom.fetchOrders(buildStoreUnit('CUSTOM'), {
        ...window,
        page: 1,
        pageSize: 2,
      });
      expect(res.orders).toHaveLength(2);
      expect(res.hasMore).toBe(true);
      expect(mock.urls().find((u) => u.includes('/bridge/v1/orders?'))).toMatch(
        /\/bridge\/v1\/orders\?/,
      );
    });
  });

  // ── Webhook accept/reject vectors ─────────────────────────────────────
  describe('webhook accept/reject vectors', () => {
    const payload = { id: 101, status: 'processing', total: '250.00' };

    describe('woocommerce (X-WC-Webhook-Signature, base64 HMAC)', () => {
      const provider = new WooCommerceProvider();
      const store = () => buildStoreUnit('WOOCOMMERCE');
      const secret = 'wh_woo_secret';

      it('accepts a correctly signed delivery', () => {
        const delivery = buildWooDelivery(secret, payload);
        const res = provider.verifyWebhook(store(), delivery.headers, delivery.rawBody);
        expect(res).toMatchObject({
          valid: true,
          deliveryId: 'woo-delivery-1',
          topic: 'order.created',
        });
      });

      it('rejects a tampered body (bad-signature)', () => {
        const delivery = buildWooDelivery(secret, payload);
        const tampered = Buffer.from(delivery.rawBody);
        tampered[5] ^= 1;
        const res = provider.verifyWebhook(store(), delivery.headers, tampered);
        expect(res).toEqual({ valid: false, reason: 'bad-signature' });
      });

      it('rejects a wrong-secret signature (bad-signature)', () => {
        const delivery = buildWooDelivery('another-secret', payload);
        const res = provider.verifyWebhook(store(), delivery.headers, delivery.rawBody);
        expect(res).toEqual({ valid: false, reason: 'bad-signature' });
      });

      it('rejects a missing signature (missing-signature)', () => {
        const delivery = buildWooDelivery(secret, payload);
        const res = provider.verifyWebhook(
          store(),
          { 'X-WC-Webhook-Delivery-ID': 'woo-delivery-1' },
          delivery.rawBody,
        );
        expect(res).toEqual({ valid: false, reason: 'missing-signature' });
      });

      it('rejects when no secret is configured (no-secret-configured)', () => {
        const delivery = buildWooDelivery(secret, payload);
        const secretless = buildStoreUnit('WOOCOMMERCE', {
          secrets: { webhookSecret: '' },
        });
        const res = provider.verifyWebhook(secretless, delivery.headers, delivery.rawBody);
        expect(res).toEqual({ valid: false, reason: 'no-secret-configured' });
      });
    });

    describe('shopify (HMAC + delivery id + topic)', () => {
      const provider = new ShopifyProvider();
      const store = () => buildStoreUnit('SHOPIFY');
      const secret = 'wh_shopify_secret';

      it('accepts a correctly signed delivery with topic', () => {
        const delivery = buildShopifyDelivery(secret, payload);
        const res = provider.verifyWebhook(store(), delivery.headers, delivery.rawBody);
        expect(res).toMatchObject({
          valid: true,
          deliveryId: 'shopify-delivery-1',
          topic: 'orders/create',
        });
      });

      it('rejects a tampered body (bad-signature)', () => {
        const delivery = buildShopifyDelivery(secret, payload);
        const tampered = Buffer.from(delivery.rawBody);
        tampered[tampered.length - 1] ^= 1;
        const res = provider.verifyWebhook(store(), delivery.headers, tampered);
        expect(res).toEqual({ valid: false, reason: 'bad-signature' });
      });

      it('rejects a missing delivery id (missing-delivery-id)', () => {
        const delivery = buildShopifyDelivery(secret, payload);
        const { ['X-Shopify-Webhook-Id']: _drop, ...headers } = delivery.headers;
        void _drop;
        const res = provider.verifyWebhook(store(), headers, delivery.rawBody);
        expect(res).toEqual({ valid: false, reason: 'missing-delivery-id' });
      });

      it('rejects a missing signature (missing-signature)', () => {
        const delivery = buildShopifyDelivery(secret, payload);
        const res = provider.verifyWebhook(
          store(),
          { 'X-Shopify-Webhook-Id': 'shopify-delivery-1' },
          delivery.rawBody,
        );
        expect(res).toEqual({ valid: false, reason: 'missing-signature' });
      });
    });

    describe.each([
      ['custom bridge', () => new CustomBridgeProvider(), () => buildStoreUnit('CUSTOM')],
      ['fake', makeFake, () => buildStoreUnit('CUSTOM')],
    ])('%s (X-EcoMate-Signature + delivery id + 5-minute replay window)', (_label, make, storeOf) => {
      const secret = 'wh_custom_secret';

      it('accepts a fresh correctly signed delivery', () => {
        const provider = make();
        const delivery = buildCustomDelivery(secret, payload);
        const res = provider.verifyWebhook(storeOf(), delivery.headers, delivery.rawBody);
        expect(res).toMatchObject({ valid: true, deliveryId: 'custom-delivery-1' });
      });

      it('rejects a stale timestamp (stale-timestamp)', () => {
        const provider = make();
        const delivery = buildCustomDelivery(secret, payload, { timestamp: '0' });
        const res = provider.verifyWebhook(storeOf(), delivery.headers, delivery.rawBody);
        expect(res).toEqual({ valid: false, reason: 'stale-timestamp' });
      });

      it('rejects a missing delivery id (missing-delivery-id)', () => {
        const provider = make();
        const delivery = buildCustomDelivery(secret, payload);
        const { ['X-EcoMate-Delivery-Id']: _drop, ...headers } = delivery.headers;
        void _drop;
        const res = provider.verifyWebhook(storeOf(), headers, delivery.rawBody);
        expect(res).toEqual({ valid: false, reason: 'missing-delivery-id' });
      });

      it('rejects a tampered body (bad-signature)', () => {
        const provider = make();
        const delivery = buildCustomDelivery(secret, payload);
        const tampered = Buffer.from(delivery.rawBody);
        tampered[0] ^= 1;
        const res = provider.verifyWebhook(storeOf(), delivery.headers, tampered);
        expect(res).toEqual({ valid: false, reason: 'bad-signature' });
      });
    });
  });

  // ── Retry classification (§8.1, pure) ─────────────────────────────────
  describe('retry classification (§8.1)', () => {
    it.each([
      [401, false, ProviderErrorCategory.AUTHENTICATION_FAILED],
      [403, false, ProviderErrorCategory.INVALID_REQUEST],
      [404, false, ProviderErrorCategory.REMOTE_NOT_FOUND],
      [400, false, ProviderErrorCategory.INVALID_REQUEST],
      [422, false, ProviderErrorCategory.INVALID_REQUEST],
      [429, true, ProviderErrorCategory.RATE_LIMITED],
      [408, true, ProviderErrorCategory.TEMPORARY_FAILURE],
      [500, true, ProviderErrorCategory.TEMPORARY_FAILURE],
      [502, true, ProviderErrorCategory.TEMPORARY_FAILURE],
      [503, true, ProviderErrorCategory.TEMPORARY_FAILURE],
    ])('http %i → retryable=%s (%s)', (status, retryable, category) => {
      expect(classifyHttpStatus(status)).toMatchObject({ retryable, category });
    });

    it('passes ProviderError categories through (transient retryable, permanent never loops)', () => {
      expect(
        classifyProviderError(
          new ProviderError('slow down', ProviderErrorCategory.RATE_LIMITED, 'woocommerce'),
        ),
      ).toMatchObject({ retryable: true, category: ProviderErrorCategory.RATE_LIMITED });
      expect(
        classifyProviderError(
          new ProviderError('down', ProviderErrorCategory.TEMPORARY_FAILURE, 'shopify'),
        ),
      ).toMatchObject({ retryable: true, category: ProviderErrorCategory.TEMPORARY_FAILURE });
      for (const category of [
        ProviderErrorCategory.AUTHENTICATION_FAILED,
        ProviderErrorCategory.INVALID_REQUEST,
        ProviderErrorCategory.REMOTE_NOT_FOUND,
        ProviderErrorCategory.UNKNOWN,
      ]) {
        expect(
          classifyProviderError(new ProviderError('nope', category, 'custom')),
        ).toMatchObject({ retryable: false, category });
      }
    });

    it('treats network-layer failures as retryable transient', () => {
      expect(classifyProviderError(new TypeError('fetch failed'))).toMatchObject({
        retryable: true,
        category: ProviderErrorCategory.TEMPORARY_FAILURE,
      });
      expect(classifyProviderError(networkError('ECONNREFUSED'))).toMatchObject({
        retryable: true,
        category: ProviderErrorCategory.TEMPORARY_FAILURE,
      });
      expect(classifyProviderError({ status: 429 })).toMatchObject({
        retryable: true,
        category: ProviderErrorCategory.RATE_LIMITED,
      });
    });

    it('is fail-closed for unknown errors (single attempt)', () => {
      expect(classifyProviderError(new Error('boom'))).toMatchObject({
        retryable: false,
        category: ProviderErrorCategory.UNKNOWN,
      });
    });

    it('locks the §8.1 backoff ladder and attempt cap', () => {
      expect(RETRY_BACKOFF_MS).toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
      expect(MAX_SYNC_ATTEMPTS).toBe(5);
    });
  });

  // ── Failure injection (Fake scripted failures) ────────────────────────
  describe('failure injection (Fake)', () => {
    it('injected auth failure throws once with its category, then recovers', async () => {
      const { fake, store } = seededFake();
      fake.injectFailure({
        method: 'upsertProduct',
        times: 1,
        category: ProviderErrorCategory.AUTHENTICATION_FAILED,
        message: '[fake] session expired',
      });
      const input = buildProductFixture({ sku: 'SKU-P2-FAIL' });
      const err = await fake.upsertProduct(store, { ...input }, ['name', 'sku']).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.category).toBe(ProviderErrorCategory.AUTHENTICATION_FAILED);
      expect(classifyProviderError(err).retryable).toBe(false);
      // Injection exhausted → the retry succeeds with the same input.
      const ref = await fake.upsertProduct(store, { ...input }, ['name', 'sku']);
      expect(ref.providerId).toMatch(/^fake-prod-/);
    });

    it('injected transient failure classifies retryable', async () => {
      const { fake, store } = seededFake();
      fake.injectFailure({
        method: 'fetchOrders',
        times: 1,
        category: ProviderErrorCategory.TEMPORARY_FAILURE,
      });
      const err = await fake
        .fetchOrders(store, {
          since: new Date('2026-09-20T00:00:00.000Z'),
          until: new Date('2026-09-24T23:59:59.999Z'),
          page: 1,
          pageSize: 10,
        })
        .catch((e) => e);
      expect(err.category).toBe(ProviderErrorCategory.TEMPORARY_FAILURE);
      expect(classifyProviderError(err).retryable).toBe(true);
    });
  });
});
