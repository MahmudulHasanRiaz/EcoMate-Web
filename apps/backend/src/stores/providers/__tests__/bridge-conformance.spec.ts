/**
 * Bridge v1 conformance suite — central-commerce P10 deliverable 3.
 *
 * A custom site can run this suite (documented npm path: `npx jest
 * bridge-conformance`) to prove its bridge implements
 * `docs/central-commerce/BRIDGE-V1-PROTOCOL.md`. Here it runs the REAL
 * `CustomBridgeProvider` against the in-repo reference stub bridge
 * (`reference-bridge.ts`, test-only) through the P2 `MockFetch` seam —
 * proving a custom store connects using only the documented spec.
 *
 * Vectors (protocol §10): manifest validation, testConnection taxonomy +
 * media preflight, signature vectors, order-pull window, product/variant/
 * category/media/publication/delete round-trips, status push + read-back,
 * stock status-only wire shape, the unsupported-fidelity zero-write gate,
 * webhook registration, and capability-gated loud skips (never silent).
 */
import { ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import {
  BRIDGE_WEBHOOK_TOPICS,
  CustomBridgeProvider,
  bridgeFieldToPayload,
  bridgeManifestToCapabilities,
  bridgeProductToSnapshots,
  bridgeSlugify,
  bridgeVariantToPayload,
} from '../custom-bridge.provider';
import { snapshotField } from '../field-snapshot';
import {
  MockFetch,
  buildCustomDelivery,
  buildStoreUnit,
  jsonResponse,
  networkError,
} from './fixtures';
import { ReferenceBridge } from './reference-bridge';

const STORE = () => buildStoreUnit('CUSTOM');

function wired(bridge: ReferenceBridge): { provider: CustomBridgeProvider; mock: MockFetch; bridge: ReferenceBridge } {
  const mock = new MockFetch();
  mock.onPrefix(bridge.baseUrl, bridge.handle);
  return { provider: new CustomBridgeProvider(mock.fetch), mock, bridge };
}

describe('Bridge v1 conformance (P10)', () => {
  // ── Manifest validation (protocol §1) ─────────────────────────────────
  describe('manifest validation', () => {
    it('accepts a full manifest; capabilities resolve to the declared set', async () => {
      const { provider } = wired(new ReferenceBridge());
      const caps = await provider.resolveCapabilities(STORE());
      expect(caps).toMatchObject({
        products: true,
        variations: true,
        categories: true,
        media: true,
        delete: true,
        seo: true,
        costPrice: false,
        stockStatusFidelity: 'faithful',
        contactCheckExposure: true,
        combos: false,
        categoryModel: 'custom',
        seoModel: 'native',
        mediaModel: 'url-fetch',
      });
      expect(caps.orderStatusUpdateTargets).toEqual(['cancelled', 'completed']);
    });

    it('narrows: false flags + unsupported fidelity + subset targets', async () => {
      const { provider } = wired(
        new ReferenceBridge({
          capabilities: {
            seo: false,
            dimensions: false,
            stockStatusFidelity: 'unsupported',
            orderStatusUpdateTargets: ['cancelled'],
          },
        }),
      );
      const caps = await provider.resolveCapabilities(STORE());
      expect(caps.seo).toBe(false);
      expect(caps.dimensions).toBe(false);
      expect(caps.products).toBe(true);
      expect(caps.stockStatusFidelity).toBe('unsupported');
      expect(caps.orderStatusUpdateTargets).toEqual(['cancelled']);
    });

    it('forces combos=false even when the manifest claims true (BR-22)', () => {
      const caps = bridgeManifestToCapabilities(
        { storeId: 'x', capabilities: { combos: true } },
        new CustomBridgeProvider().declaredCapabilities,
      );
      expect(caps.combos).toBe(false);
    });

    it('intersects unknown status targets out; enables manifest costPrice (BR-23 push-only) + stockQuantity (P13)', () => {
      const caps = bridgeManifestToCapabilities(
        {
          storeId: 'x',
          capabilities: { orderStatusUpdateTargets: ['cancelled', 'weird'], costPrice: true, stockQuantity: true },
        },
        new CustomBridgeProvider().declaredCapabilities,
      );
      expect(caps.orderStatusUpdateTargets).toEqual(['cancelled']);
      expect(caps.costPrice).toBe(true);
      expect(caps.stockQuantity).toBe(true);
    });

    it('stockQuantity defaults to status-only when undeclared (P13)', () => {
      const caps = bridgeManifestToCapabilities(
        { storeId: 'x', capabilities: {} },
        new CustomBridgeProvider().declaredCapabilities,
      );
      expect(caps.stockQuantity).toBe(false);
      expect(caps.stockStatusFidelity).toBe('faithful');
    });

    it('never widens default-false flags other than costPrice', () => {
      const declared = new CustomBridgeProvider().declaredCapabilities;
      const caps = bridgeManifestToCapabilities(
        { storeId: 'x', capabilities: { costPrice: false } },
        { ...declared, costPrice: false },
      );
      expect(caps.costPrice).toBe(false);
    });

    it('falls back to declared safe defaults when the manifest is unreachable (never throws)', async () => {
      const mock = new MockFetch();
      mock.onAll(() => {
        throw networkError('ECONNREFUSED');
      });
      const caps = await new CustomBridgeProvider(mock.fetch).resolveCapabilities(STORE());
      expect(caps).toEqual(new CustomBridgeProvider().declaredCapabilities);
    });

    it('missing storeId → reachable + authenticated but permissionsOk=false (never a connected store)', async () => {
      const { provider } = wired(new ReferenceBridge({ invalidManifest: 'missing-storeId' }));
      await expect(provider.testConnection(STORE())).resolves.toMatchObject({
        reachable: true,
        authenticated: true,
        permissionsOk: false,
      });
    });
  });

  // ── testConnection taxonomy + preflight ───────────────────────────────
  describe('testConnection', () => {
    it('200 → reachable + auth + permissions + providerStoreId + resolved caps', async () => {
      const { provider, mock } = wired(new ReferenceBridge({ storeId: 'bridge-store-9' }));
      const res = await provider.testConnection(STORE());
      expect(res).toMatchObject({
        reachable: true,
        authenticated: true,
        permissionsOk: true,
        providerStoreId: 'bridge-store-9',
      });
      expect(res.capabilities.stockStatusFidelity).toBe('faithful');
      expect(res.mediaReachable).toBeUndefined();
      expect(mock.calls[0]?.url).toBe('https://bridge.example.test/.well-known/ecomate-bridge');
      expect(mock.calls[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer bridge_test_key' });
    });

    it('wrong bridge key → reachable but not authenticated (never a throw)', async () => {
      const { provider } = wired(new ReferenceBridge());
      const res = await provider.testConnection(
        buildStoreUnit('CUSTOM', { secrets: { bridgeKey: 'wrong-key' } }),
      );
      expect(res).toMatchObject({ reachable: true, authenticated: false, permissionsOk: false });
    });

    it('403 → authenticated but permissions fail; 500 → reachable but not authenticated', async () => {
      for (const status of [403, 500]) {
        const mock = new MockFetch();
        mock.onAll(() => jsonResponse(status, { error: { code: 'x', message: 'x' } }));
        const res = await new CustomBridgeProvider(mock.fetch).testConnection(STORE());
        expect(res.reachable).toBe(true);
        if (status === 403) {
          expect(res.authenticated).toBe(true);
          expect(res.permissionsOk).toBe(false);
        } else {
          expect(res.authenticated).toBe(false);
        }
      }
    });

    it('network failure → unreachable as data; missing keys → zero HTTP calls', async () => {
      const down = new MockFetch();
      down.onAll(() => {
        throw networkError('ECONNREFUSED');
      });
      await expect(new CustomBridgeProvider(down.fetch).testConnection(STORE())).resolves.toMatchObject({
        reachable: false,
        authenticated: false,
      });
      const mock = new MockFetch();
      mock.onAll(() => jsonResponse(200, { storeId: 'x' }));
      const bare = buildStoreUnit('CUSTOM', { secrets: { bridgeKey: '' } });
      await expect(new CustomBridgeProvider(mock.fetch).testConnection(bare)).resolves.toMatchObject({
        reachable: false,
      });
      expect(mock.calls).toHaveLength(0);
    });

    it('media preflight: manifest probe URL HEAD ok → true, failing → false, unset → undefined', async () => {
      const cdn = 'https://cdn.example.test/probe.jpg';
      const okMock = new MockFetch();
      const okBridge = new ReferenceBridge();
      okMock
        .onPrefix(cdn, () => jsonResponse(200, {}))
        .onPrefix(okBridge.baseUrl, okBridge.handle);
      const okRes = await new CustomBridgeProvider(okMock.fetch).testConnection(
        buildStoreUnit('CUSTOM', { settings: { mediaProbeUrl: cdn } }),
      );
      expect(okRes.mediaReachable).toBe(true);

      const failMock = new MockFetch();
      const failBridge = new ReferenceBridge();
      failMock
        .onPrefix(cdn, () => {
          throw networkError();
        })
        .onPrefix(failBridge.baseUrl, failBridge.handle);
      const failRes = await new CustomBridgeProvider(failMock.fetch).testConnection(
        buildStoreUnit('CUSTOM', { settings: { mediaProbeUrl: cdn } }),
      );
      expect(failRes.mediaReachable).toBe(false);
    });
  });

  // ── Signature vectors (protocol §2) ───────────────────────────────────
  describe('webhook signing', () => {
    const secret = 'wh_custom_secret';
    const payload = { id: 'ext-order-1', status: 'processing' };

    it('accepts a fresh correctly signed delivery with topic', () => {
      const d = buildCustomDelivery(secret, payload);
      expect(new CustomBridgeProvider().verifyWebhook(STORE(), d.headers, d.rawBody)).toMatchObject({
        valid: true,
        deliveryId: 'custom-delivery-1',
        topic: 'order.created',
      });
    });

    it('rejects tampered body / wrong secret / stale timestamp / missing fields', () => {
      const provider = new CustomBridgeProvider();
      const d = buildCustomDelivery(secret, payload);
      const tampered = Buffer.from(d.rawBody);
      tampered[tampered.length - 1] ^= 1;
      expect(provider.verifyWebhook(STORE(), d.headers, tampered)).toEqual({
        valid: false,
        reason: 'bad-signature',
      });
      const wrong = buildCustomDelivery('another-secret', payload);
      expect(provider.verifyWebhook(STORE(), wrong.headers, wrong.rawBody)).toEqual({
        valid: false,
        reason: 'bad-signature',
      });
      const stale = buildCustomDelivery(secret, payload, { timestamp: '0' });
      expect(provider.verifyWebhook(STORE(), stale.headers, stale.rawBody)).toEqual({
        valid: false,
        reason: 'stale-timestamp',
      });
      expect(provider.verifyWebhook(STORE(), { 'X-EcoMate-Delivery-Id': 'x', 'X-EcoMate-Timestamp': d.headers['X-EcoMate-Timestamp'] }, d.rawBody)).toEqual({
        valid: false,
        reason: 'missing-signature',
      });
      const { ['X-EcoMate-Delivery-Id']: _drop, ...noId } = d.headers;
      void _drop;
      expect(provider.verifyWebhook(STORE(), noId, d.rawBody)).toEqual({
        valid: false,
        reason: 'missing-delivery-id',
      });
    });
  });

  // ── Order pull window (protocol §5) ───────────────────────────────────
  describe('order pull', () => {
    const window = {
      since: new Date('2026-09-20T00:00:00.000Z'),
      until: new Date('2026-09-24T23:59:59.999Z'),
    };

    it('pages 1-based across the window (5 orders, pageSize 2 → 2/2/1)', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const p1 = await provider.fetchOrders(STORE(), { ...window, page: 1, pageSize: 2 });
      const p2 = await provider.fetchOrders(STORE(), { ...window, page: 2, pageSize: 2 });
      const p3 = await provider.fetchOrders(STORE(), { ...window, page: 3, pageSize: 2 });
      expect(p1.orders.map((o) => (o as any).id)).toEqual(['ext-order-1', 'ext-order-2']);
      expect(p1.hasMore).toBe(true);
      expect(p2.orders.map((o) => (o as any).id)).toEqual(['ext-order-3', 'ext-order-4']);
      expect(p2.hasMore).toBe(true);
      expect(p3.orders.map((o) => (o as any).id)).toEqual(['ext-order-5']);
      expect(p3.hasMore).toBe(false);
      const firstPull = mock.calls.find((c) => c.url.includes('/bridge/v1/orders?'));
      expect(firstPull?.url).toMatch(/\/bridge\/v1\/orders\?/);
      expect(firstPull?.url).toMatch(/page=1/);
      expect(firstPull?.url).toMatch(/since=.*09-20/);
    });

    it('window edges are inclusive; status filter narrows; empty window returns nothing', async () => {
      const { provider } = wired(new ReferenceBridge());
      const all = await provider.fetchOrders(STORE(), {
        since: new Date('2026-09-20T10:00:00.000Z'),
        until: new Date('2026-09-24T14:00:00.000Z'),
        page: 1,
        pageSize: 10,
      });
      expect(all.orders).toHaveLength(5);
      const filtered = await provider.fetchOrders(STORE(), {
        ...window,
        status: ['processing'],
        page: 1,
        pageSize: 10,
      });
      expect(filtered.orders.map((o) => (o as any).id).sort()).toEqual(['ext-order-1', 'ext-order-4']);
      const empty = await provider.fetchOrders(STORE(), {
        since: new Date('2026-09-25T00:00:00.000Z'),
        until: new Date('2026-09-28T00:00:00.000Z'),
        page: 1,
        pageSize: 10,
      });
      expect(empty.orders).toEqual([]);
      expect(empty.hasMore).toBe(false);
    });

    it('orders:false in the manifest → loud CAPABILITY_UNSUPPORTED (never silent)', async () => {
      const { provider } = wired(new ReferenceBridge({ capabilities: { orders: false } }));
      await expect(provider.fetchOrders(STORE(), { ...window, page: 1, pageSize: 10 })).rejects.toMatchObject({
        category: ProviderErrorCategory.INVALID_REQUEST,
      });
    });
  });

  // ── Products (protocol §3, Table A) ───────────────────────────────────
  describe('products', () => {
    it('maps the Table A columns, never cost/qty/secrets', () => {
      const caps = new CustomBridgeProvider().declaredCapabilities;
      const payload = bridgeFieldToPayload(
        {
          name: 'Tee',
          fullDescription: 'Full',
          sku: 'SKU-001',
          price: '250',
          salePrice: '200',
          slug: 'tee',
          brand: 'EcoMate',
          tags: ['a', 'b'],
          weight: 0.5,
          dimensions: { length: 1, width: 2, height: 3 },
          publicationState: 'published',
          primaryImage: 'https://cdn.example.test/tee.jpg',
          costPrice: '10',
          customFields: { material: 'cotton', webhookSecret: 'shh' },
        },
        caps,
      );
      expect(payload).toMatchObject({
        name: 'Tee',
        description: 'Full',
        sku: 'SKU-001',
        price: '250',
        sale_price: '200',
        slug: 'tee',
        brand: 'EcoMate',
        tags: ['a', 'b'],
        weight: 0.5,
        status: 'published',
      });
      expect(payload.images).toEqual([{ src: 'https://cdn.example.test/tee.jpg' }]);
      expect(payload.custom_fields).toEqual({ material: 'cotton' });
      const wire = JSON.stringify(payload);
      expect(wire).not.toMatch(/cost/i);
      expect(wire).not.toMatch(/quantity/i);
      expect(wire).not.toMatch(/shh/);
    });

    it('manifest-narrowed fields are omitted (seo/dimensions off → absent)', () => {
      const caps = bridgeManifestToCapabilities(
        { storeId: 'x', capabilities: { seo: false, dimensions: false } },
        new CustomBridgeProvider().declaredCapabilities,
      );
      const payload = bridgeFieldToPayload(
        { name: 'T', sku: 'S', seoTitle: 'SEO', dimensions: { length: 1, width: 1, height: 1 } },
        caps,
      );
      expect(payload.seo_title).toBeUndefined();
      expect(payload.dimensions).toBeUndefined();
      expect(payload.name).toBe('T');
    });

    it('combo input throws COMBO_SKIPPED before any HTTP call (BR-22)', async () => {
      expect(() => bridgeFieldToPayload({ productType: 'combo', name: 'C' }, new CustomBridgeProvider().declaredCapabilities)).toThrow(
        /COMBO_SKIPPED/,
      );
      expect(() => bridgeVariantToPayload({ productType: 'combo', sku: 'C' })).toThrow(/COMBO_SKIPPED/);
      const { provider, mock } = wired(new ReferenceBridge());
      await expect(
        provider.upsertProduct(STORE(), { productType: 'combo', name: 'C', sku: 'C' } as any, ['name']),
      ).rejects.toThrow(/COMBO_SKIPPED/);
      expect(mock.calls).toHaveLength(1); // manifest GET only — no product write
      expect(mock.urls().every((u) => !u.includes('/bridge/v1/products?') && !u.endsWith('/bridge/v1/products'))).toBe(true);
    });

    it('missing SKU throws with zero HTTP calls (Table B rows 4–6)', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      await expect(provider.upsertProduct(STORE(), { name: 'No SKU' } as any, ['name'])).rejects.toMatchObject({
        category: ProviderErrorCategory.INVALID_REQUEST,
      });
      expect(mock.calls).toHaveLength(0);
    });

    it('creates, then updates idempotently on SKU match (no duplicate)', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const ref = await provider.upsertProduct(
        STORE(),
        { sku: 'SKU-BR-001', name: 'Tee', price: '250', publicationState: 'published' } as any,
        ['name', 'price', 'publicationState', 'sku'],
      );
      expect(ref.providerId).toBeDefined();
      const ref2 = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-001', name: 'Renamed' } as any, ['name']);
      expect(ref2).toEqual(ref);
      expect(mock.calls.filter((c) => c.init?.method === 'POST' && c.url.endsWith('/bridge/v1/products'))).toHaveLength(1);
    });

    it('field-scoped update sends only the requested keys (price pair travels together)', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-002', name: 'T', price: '100' } as any, [
        'name',
        'price',
        'sku',
      ]);
      mock.calls.length = 0;
      await provider.upsertProduct(STORE(), { sku: 'SKU-BR-002', name: 'T2', price: '999' } as any, ['price']);
      // One manifest GET + one SKU lookup + one scoped PUT.
      const put = mock.calls.find((c) => c.init?.method === 'PUT');
      expect(put).toBeDefined();
      const body = JSON.parse(String(put?.init?.body ?? '{}'));
      expect(body).toEqual({ price: '999' });
    });

    it('snapshots derive through the matrix keys (cost always null — BR-23)', async () => {
      const { provider } = wired(new ReferenceBridge());
      const ref = await provider.upsertProduct(
        STORE(),
        { sku: 'SKU-BR-003', name: 'Snap', slug: 'snap', price: '250', publicationState: 'published' } as any,
        ['name', 'slug', 'price', 'publicationState', 'sku'],
      );
      const snaps = await provider.readProductFields(STORE(), ref, [
        'name',
        'slug',
        'price',
        'salePrice',
        'costPrice',
        'publicationState',
      ]);
      expect(snaps.name?.value).toBe('Snap');
      expect(snaps.slug?.value).toBe('snap');
      expect(snaps.price?.value).toBe('250');
      expect(snaps.costPrice?.value).toBeNull();
      expect(snaps.publicationState?.value).toBe('published');
      expect(snaps.name?.hash).toBe(snapshotField('Snap').hash);
    });

    it('slugifies category handles deterministically', () => {
      expect(bridgeSlugify('Men / Shirts!')).toBe('men-shirts');
    });
  });

  // ── Variants / categories / media / publication / delete ─────────────
  describe('variants + categories + media + publication + delete', () => {
    it('upsertVariants creates missing + updates matched by SKU', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-VAR', name: 'V' } as any, ['name', 'sku']);
      const out = await provider.upsertVariants(STORE(), ref, [
        { sku: 'SKU-VAR-A', price: '400', attributes: { Size: 'M' } },
        { sku: 'SKU-VAR-B', price: '350', salePrice: '300' },
      ] as any);
      expect(out.get('SKU-VAR-A')?.providerId).toBeDefined();
      expect(out.get('SKU-VAR-B')?.providerId).toBeDefined();
      const out2 = await provider.upsertVariants(STORE(), ref, [{ sku: 'SKU-VAR-A', price: '410' }] as any);
      expect(out2.get('SKU-VAR-A')).toEqual(out.get('SKU-VAR-A'));
      expect(mock.calls.filter((c) => c.url.includes('/bridge/v1/variants/') && c.init?.method === 'PUT')).toHaveLength(1);
    });

    it('ensureCategories looks up before creating; second ensure issues zero POSTs', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const out = await provider.ensureCategories(STORE(), [['Men', 'Shirts']]);
      expect(out.get('Men / Shirts')?.providerId).toBeDefined();
      const posts = mock.calls.filter((c) => c.init?.method === 'POST').length;
      expect(posts).toBe(2);
      mock.calls.length = 0;
      const out2 = await provider.ensureCategories(STORE(), [['Men', 'Shirts']]);
      expect(out2.get('Men / Shirts')).toEqual(out.get('Men / Shirts'));
      expect(mock.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
    });

    it('renameCategory PUTs the mapped term; move re-parents; unsupported move is a loud skip', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const cats = await provider.ensureCategories(STORE(), [['Men']]);
      const ref = cats.get('Men')!;
      const renamed = await provider.renameCategory(STORE(), ref, { name: 'Tees', slug: 'tees' });
      expect(renamed.ok).toBe(true);
      expect(JSON.parse(String(mock.calls.find((c) => c.init?.method === 'PUT')?.init?.body ?? '{}'))).toMatchObject({
        name: 'Tees',
        slug: 'tees',
      });
      const moved = await provider.moveCategory(STORE(), ref, null);
      expect(moved.ok).toBe(true);
      expect(moved.skipped).toBeUndefined();

      const stuck = wired(new ReferenceBridge({ supportCategoryMove: false }));
      const cats2 = await stuck.provider.ensureCategories(STORE(), [['Men']]);
      const skipped = await stuck.provider.moveCategory(STORE(), cats2.get('Men')!, null);
      expect(skipped.skipped).toBe(true);
      expect(skipped.reason).toMatch(/CATEGORY_MOVE_UNSUPPORTED/);
    });

    it('ensureMedia reuses by hash (exactly one POST for two srcs, same hash)', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const first = await provider.ensureMedia(STORE(), [{ src: 'https://cdn.example.test/a.jpg', hash: 'hash-reuse-9' }] as any);
      const second = await provider.ensureMedia(STORE(), [
        { src: 'https://cdn.example.test/a-renamed.jpg', hash: 'hash-reuse-9' },
      ] as any);
      expect(second.get('https://cdn.example.test/a-renamed.jpg')).toEqual(first.get('https://cdn.example.test/a.jpg'));
      expect(mock.calls.filter((c) => c.init?.method === 'POST' && c.url.endsWith('/bridge/v1/media'))).toHaveLength(1);
    });

    it('setPublication maps published/draft; deleteProduct removes; second delete → REMOTE_NOT_FOUND', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-DEL', name: 'D' } as any, ['name', 'sku']);
      await provider.setPublication(STORE(), ref, 'draft');
      expect(JSON.parse(String(mock.calls.filter((c) => c.url.includes('/publication'))[0]?.init?.body ?? '{}'))).toEqual({
        state: 'draft',
      });
      await provider.setPublication(STORE(), ref, 'published');
      await expect(provider.deleteProduct(STORE(), ref)).resolves.toMatchObject({ ok: true });
      await expect(provider.deleteProduct(STORE(), ref)).rejects.toMatchObject({
        category: ProviderErrorCategory.REMOTE_NOT_FOUND,
      });
    });

    it('delete:false in the manifest → loud CAPABILITY_UNSUPPORTED (BR-09)', async () => {
      const { provider } = wired(new ReferenceBridge({ capabilities: { delete: false } }));
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-NODEL', name: 'N' } as any, ['name', 'sku']);
      await expect(provider.deleteProduct(STORE(), ref)).rejects.toThrow(/CAPABILITY_UNSUPPORTED/);
    });
  });

  // ── Stock status + quantity (protocol §4, P13) ────────────────────────
  describe('stock status + quantity projection (P13 §4)', () => {
    it('faithful default: PUT body carries ONLY {status}; read-back verifies', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-STOCK', name: 'S' } as any, ['name', 'sku']);
      await provider.publishStockState(STORE(), ref, 'OUT_OF_STOCK');
      await expect(provider.readStockState(STORE(), ref)).resolves.toBe('OUT_OF_STOCK');
      await provider.publishStockState(STORE(), ref, 'IN_STOCK');
      await expect(provider.readStockState(STORE(), ref)).resolves.toBe('IN_STOCK');
      const puts = mock.calls.filter((c) => c.init?.method === 'PUT' && c.url.includes('/stock'));
      expect(puts).toHaveLength(2);
      for (const put of puts) {
        expect(JSON.parse(String(put.init?.body ?? '{}'))).toEqual({ status: expect.stringMatching(/in_stock|out_of_stock/) });
      }
    });

    it('quantity-declared bridge: {status, quantity} round-trips per product and variation', async () => {
      const { provider, mock, bridge } = wired(new ReferenceBridge({ capabilities: { stockQuantity: true } }));
      await expect(provider.resolveCapabilities(STORE())).resolves.toMatchObject({ stockQuantity: true });
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-QTY', name: 'Q' } as any, ['name', 'sku']);
      await provider.publishStockQuantity(STORE(), ref, 3);
      await expect(provider.readStockQuantity(STORE(), ref)).resolves.toBe(3);
      const puts = mock.calls.filter((c) => c.init?.method === 'PUT' && c.url.includes('/stock'));
      expect(puts).toHaveLength(1);
      expect(JSON.parse(String(puts[0]?.init?.body ?? '{}'))).toEqual({ status: 'in_stock', quantity: 3 });
      expect(bridge.stockOf(ref.providerId)).toMatchObject({ status: 'in_stock', quantity: 3 });

      const vars = await provider.upsertVariants(STORE(), ref, [{ sku: 'SKU-VST-A', price: '10' }] as any);
      const vref = vars.get('SKU-VST-A')!;
      await provider.publishVariantStockQuantity(STORE(), ref, vref, 0);
      await expect(provider.readVariantStockQuantity(STORE(), ref, vref)).resolves.toBe(0);
    });

    it('undeclared bridge stays status-only: quantity call degrades without a quantity key', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-DEG', name: 'D' } as any, ['name', 'sku']);
      await provider.publishStockQuantity(STORE(), ref, 3);
      const puts = mock.calls.filter((c) => c.init?.method === 'PUT' && c.url.includes('/stock'));
      expect(puts).toHaveLength(1);
      expect(JSON.parse(String(puts[0]?.init?.body ?? '{}'))).toEqual({ status: 'in_stock' });
    });

    it('variant stock round-trips per variation', async () => {
      const { provider } = wired(new ReferenceBridge());
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-VSTOCK', name: 'S' } as any, ['name', 'sku']);
      const vars = await provider.upsertVariants(STORE(), ref, [{ sku: 'SKU-VST-A', price: '10' }] as any);
      const vref = vars.get('SKU-VST-A')!;
      await provider.publishVariantStockState(STORE(), ref, vref, 'OUT_OF_STOCK');
      await expect(provider.readVariantStockState(STORE(), ref, vref)).resolves.toBe('OUT_OF_STOCK');
    });

    it('full product + stock + order flow: default bridge writes no quantity key (status-only when undeclared)', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-FULL', name: 'F', price: '250' } as any, [
        'name',
        'price',
        'sku',
      ]);
      await provider.readStockState(STORE(), ref);
      await provider.publishStockState(STORE(), ref, 'IN_STOCK');
      await provider.fetchOrders(STORE(), {
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
        expect(body).not.toMatch(/quantity/i);
        expect(body).not.toMatch(/inventory_quantity/i);
        expect(body).not.toMatch(/available/i);
      }
    });

    it('unsupported: publish throws BEFORE any stock write (zero writes — the ONLY zero-write path)', async () => {
      const stub = new ReferenceBridge({ stockStatusFidelity: 'unsupported' });
      const { provider, mock, bridge } = wired(stub);
      // Manifest resolves unsupported through the live path.
      await expect(provider.resolveCapabilities(STORE())).resolves.toMatchObject({
        stockStatusFidelity: 'unsupported',
      });
      const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-MON', name: 'M' } as any, ['name', 'sku']);
      mock.calls.length = 0;
      for (const variant of [false, true]) {
        const err = variant
          ? await provider
              .publishVariantStockState(STORE(), ref, { providerId: 'v-1' }, 'OUT_OF_STOCK')
              .catch((e) => e)
          : await provider.publishStockState(STORE(), ref, 'OUT_OF_STOCK').catch((e) => e);
        expect(err.category).toBe(ProviderErrorCategory.INVALID_REQUEST);
        expect(String(err.message)).toMatch(/zero writes/);
      }
      // Only manifest GETs — no PUT/POST anywhere.
      expect(mock.calls.filter((c) => (c.init?.method ?? 'GET') !== 'GET')).toHaveLength(0);
      // Read stays available for the drift audit.
      bridge.stock.set(ref.providerId, { status: 'out_of_stock' });
      await expect(provider.readStockState(STORE(), ref)).resolves.toBe('OUT_OF_STOCK');
    });
  });

  // ── Status push + read-back (protocol §7) ────────────────────────────
  describe('order status push', () => {
    it('cancelled/completed push the canonical targets; read-back verifies', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      await provider.pushOrderStatus(STORE(), { providerId: 'ext-order-1' }, 'cancelled');
      const push = mock.calls.find((c) => c.url.endsWith('/bridge/v1/orders/ext-order-1/status'));
      expect(push?.url).toMatch(/\/bridge\/v1\/orders\/ext-order-1\/status$/);
      expect(JSON.parse(String(push?.init?.body ?? '{}'))).toEqual({ target: 'cancelled' });
      await expect(provider.readOrderStatus(STORE(), { providerId: 'ext-order-1' })).resolves.toEqual({
        status: 'CANCELLED',
      });
      await provider.pushOrderStatus(STORE(), { providerId: 'ext-order-2' }, 'completed');
      await expect(provider.readOrderStatus(STORE(), { providerId: 'ext-order-2' })).resolves.toEqual({
        status: 'COMPLETED',
      });
    });

    it('a target outside the manifest list fails loud (never a silent no-op)', async () => {
      const { provider } = wired(new ReferenceBridge({ capabilities: { orderStatusUpdateTargets: ['cancelled'] } }));
      await expect(provider.pushOrderStatus(STORE(), { providerId: 'ext-order-3' }, 'completed')).rejects.toThrow(
        /ORDER_STATUS_TARGET_UNSUPPORTED/,
      );
      // And the allowed target still flows.
      await expect(
        provider.pushOrderStatus(STORE(), { providerId: 'ext-order-3' }, 'cancelled'),
      ).resolves.toMatchObject({ ok: true });
    });
  });

  // ── Webhook registration (protocol §6) ───────────────────────────────
  describe('ensureWebhooks', () => {
    it('registers missing topics only; second call issues zero POSTs (idempotent)', async () => {
      const { provider, mock } = wired(new ReferenceBridge());
      const res = await provider.ensureWebhooks(STORE(), 'https://api.example.test');
      expect(res).toEqual({ ok: true, topics: BRIDGE_WEBHOOK_TOPICS });
      const posts = mock.calls.filter((c) => c.init?.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(JSON.parse(String(posts[0]?.init?.body ?? '{}'))).toMatchObject({
        url: 'https://api.example.test/api/webhooks/stores/custom/store-custom-1',
        topics: BRIDGE_WEBHOOK_TOPICS,
      });
      mock.calls.length = 0;
      await expect(provider.ensureWebhooks(STORE(), 'https://api.example.test/')).resolves.toEqual({
        ok: true,
        topics: BRIDGE_WEBHOOK_TOPICS,
      });
      expect(mock.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
    });

    it('webhooks:false in the manifest → loud CAPABILITY_UNSUPPORTED (reconcile remains, BR-11)', async () => {
      const { provider } = wired(new ReferenceBridge({ capabilities: { webhooks: false } }));
      await expect(provider.ensureWebhooks(STORE(), 'https://api.example.test')).rejects.toThrow(
        /CAPABILITY_UNSUPPORTED/,
      );
    });
  });

  // ── Missing settings guard ────────────────────────────────────────────
  describe('connection guards', () => {
    it('missing settings throw INVALID_REQUEST with zero HTTP calls', async () => {
      const mock = new MockFetch();
      const bare = { id: 's', kind: 'CUSTOM', settings: {}, secrets: {} };
      await expect(
        new CustomBridgeProvider(mock.fetch).upsertProduct(bare, { sku: 'S', name: 'T' } as any, ['name']),
      ).rejects.toMatchObject({ category: ProviderErrorCategory.INVALID_REQUEST });
      await expect(
        new CustomBridgeProvider(mock.fetch).fetchOrders(bare, {
          since: new Date(),
          until: new Date(),
          page: 1,
          pageSize: 10,
        }),
      ).rejects.toMatchObject({ category: ProviderErrorCategory.INVALID_REQUEST });
      expect(mock.calls).toHaveLength(0);
    });
  });
});
