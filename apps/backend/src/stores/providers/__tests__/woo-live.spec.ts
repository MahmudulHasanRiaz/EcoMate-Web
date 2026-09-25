/**
 * WooCommerce live-HTTP spec — central-commerce P4 deliverable 6.
 *
 * Proves every live seam against MockFetch: products/variations/categories/
 * media/status/delete?force=true/orders fetch + first-contact SKU lookup.
 * P9/P10 adapters stay stubbed (contract-green, asserted in the contract
 * suite). No local WooCommerce instance exists on this machine — provider
 * behaviour is proven by fixture-replay here plus FakeProvider end-to-end
 * in product-sync.spec.ts (§13 E2E clause).
 */
import { WooCommerceProvider } from '../woocommerce.provider';
import { MockFetch, buildStoreUnit, jsonResponse } from './fixtures';

const STORE = () => buildStoreUnit('WOOCOMMERCE');

describe('WooCommerceProvider live HTTP (P4)', () => {
  it('upsertProduct creates when no SKU match, updates idempotently on match', async () => {
    const mock = new MockFetch();
    mock
      .onPrefix('https://woo.example.test/wp-json/wc/v3/products?sku=', () => jsonResponse(200, []))
      .onPrefix('https://woo.example.test/wp-json/wc/v3/products', () => jsonResponse(201, { id: 101 }));
    const woo = new WooCommerceProvider(mock.fetch);
    const ref = await woo.upsertProduct(STORE(), { sku: 'A-1', name: 'A' } as any, ['sku', 'name']);
    expect(ref.providerId).toBe('101');
    const createCall = mock.calls.find((c) => c.init?.method === 'POST');
    const body = JSON.parse(String(createCall?.init?.body));
    expect(body).toMatchObject({ sku: 'A-1', name: 'A' });
    expect(JSON.stringify(body)).not.toMatch(/cost/i);

    const mock2 = new MockFetch();
    mock2
      .onPrefix('https://woo.example.test/wp-json/wc/v3/products?sku=', () => jsonResponse(200, [{ id: 77 }]))
      .onPrefix('https://woo.example.test/wp-json/wc/v3/products/77', () => jsonResponse(200, { id: 77 }));
    const woo2 = new WooCommerceProvider(mock2.fetch);
    const ref2 = await woo2.upsertProduct(STORE(), { sku: 'A-1', name: 'A2' } as any, ['name']);
    expect(ref2.providerId).toBe('77');
    expect(mock2.calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('readProductFields snapshots through the matrix keys', async () => {
    const mock = new MockFetch();
    mock.onAll(() => jsonResponse(200, {
      id: 101, name: 'N', sku: 'A-1', status: 'publish', type: 'simple',
      regular_price: '100', sale_price: '', weight: '0.5',
      images: [{ src: 'https://cdn/1.jpg' }], categories: [{ id: 3 }], tags: [],
    }));
    const woo = new WooCommerceProvider(mock.fetch);
    const snaps = await woo.readProductFields(STORE(), { providerId: '101' }, ['name', 'price', 'publicationState']);
    expect(snaps.name?.value).toBe('N');
    expect(snaps.price?.value).toBe('100');
    expect(snaps.publicationState?.value).toBe('published');
  });

  it('ensureCategories looks up slug-within-parent before creating (no duplicates)', async () => {
    const mock = new MockFetch();
    let created = 0;
    mock.setFallback((url, init) => {
      if (String(init?.method ?? 'GET') === 'POST') {
        created += 1;
        return jsonResponse(201, { id: 10 + created });
      }
      return jsonResponse(200, []);
    });
    const woo = new WooCommerceProvider(mock.fetch);
    const out = await woo.ensureCategories(STORE(), [['Men', 'Shirts']]);
    expect(out.get('Men / Shirts')?.providerId).toBeDefined();
    expect(created).toBe(2);
    // Second ensure with both terms found remotely → zero creates.
    const mock2 = new MockFetch();
    let created2 = 0;
    mock2.setFallback((url, init) => {
      if (String(init?.method ?? 'GET') === 'POST') {
        created2 += 1;
        return jsonResponse(201, { id: 99 });
      }
      const u = new URL(url);
      if (u.searchParams.get('slug') === 'men') return jsonResponse(200, [{ id: 5, slug: 'men', parent: 0 }]);
      return jsonResponse(200, [{ id: 6, slug: 'shirts', parent: 5 }]);
    });
    const woo2 = new WooCommerceProvider(mock2.fetch);
    const out2 = await woo2.ensureCategories(STORE(), [['Men', 'Shirts']]);
    expect(out2.get('Men / Shirts')).toEqual({ providerId: '6' });
    expect(created2).toBe(0);
  });

  it('setPublication maps published/draft; deleteProduct uses ?force=true (BR-09)', async () => {
    const mock = new MockFetch();
    mock.onAll(() => jsonResponse(200, { id: 101 }));
    const woo = new WooCommerceProvider(mock.fetch);
    await woo.setPublication(STORE(), { providerId: '101' }, 'draft');
    const pubBody = JSON.parse(String(mock.calls[0]?.init?.body));
    expect(pubBody).toEqual({ status: 'draft' });
    await woo.deleteProduct(STORE(), { providerId: '101' });
    expect(mock.calls[1]?.url).toMatch(/\/products\/101\?force=true/);
    expect(mock.calls[1]?.init?.method).toBe('DELETE');
  });

  it('stock read/publish is status-only: instock/outofstock, never quantities (BR-06)', async () => {
    const mock = new MockFetch();
    mock.onAll(() => jsonResponse(200, { id: 101, stock_status: 'outofstock' }));
    const woo = new WooCommerceProvider(mock.fetch);
    expect(await woo.readStockState(STORE(), { providerId: '101' })).toBe('OUT_OF_STOCK');
    await woo.publishStockState(STORE(), { providerId: '101' }, 'IN_STOCK');
    const body = JSON.parse(String(mock.calls[1]?.init?.body));
    expect(body).toEqual({ stock_status: 'instock' });
  });

  it('fetchOrders passes window + pagination; pushOrderStatus targets cancelled/completed', async () => {
    const mock = new MockFetch();
    mock.onAll(() => jsonResponse(200, [{ id: 5001, status: 'processing' }]));
    const woo = new WooCommerceProvider(mock.fetch);
    const res = await woo.fetchOrders(STORE(), {
      since: new Date('2026-09-20T00:00:00.000Z'),
      until: new Date('2026-09-24T00:00:00.000Z'),
      page: 2, pageSize: 25,
    });
    expect(res.orders).toHaveLength(1);
    expect(mock.calls[0]?.url).toMatch(/after=.*09-20/);
    expect(mock.calls[0]?.url).toMatch(/page=2/);
    await woo.pushOrderStatus(STORE(), { providerId: '5001' }, 'cancelled');
    expect(JSON.parse(String(mock.calls[1]?.init?.body))).toEqual({ status: 'cancelled' });
  });

  it('ensureMedia resolves url-fetch refs without HTTP (identity = src hash)', async () => {
    const mock = new MockFetch();
    const woo = new WooCommerceProvider(mock.fetch);
    const out = await woo.ensureMedia(STORE(), [{ src: 'https://cdn/1.jpg', hash: 'abc' }] as any);
    expect(out.get('https://cdn/1.jpg')?.providerId).toBe('woo-media:abc');
    expect(mock.calls).toHaveLength(0);
  });

  it('missing connection settings throw INVALID_REQUEST (never an unauthed call)', async () => {
    const mock = new MockFetch();
    const woo = new WooCommerceProvider(mock.fetch);
    await expect(
      woo.readProductFields({ id: 's', kind: 'WOOCOMMERCE', settings: {}, secrets: {} }, { providerId: '1' }, ['name']),
    ).rejects.toThrow(/missing connection settings/);
    expect(mock.calls).toHaveLength(0);
  });

  it('P7: readOrderStatus reads GET /orders/{id} (read-back verification seam)', async () => {
    const mock = new MockFetch();
    mock.onAll(() => jsonResponse(200, { id: 5001, status: 'cancelled' }));
    const woo = new WooCommerceProvider(mock.fetch);
    await expect(woo.readOrderStatus(STORE(), { providerId: '5001' })).resolves.toEqual({ status: 'cancelled' });
    expect(mock.calls[0]?.url).toMatch(/\/orders\/5001$/);
    expect(mock.calls[0]?.init?.method ?? 'GET').not.toBe('PUT');
  });

  it('P7: push→read-back round-trip over live HTTP (cancelled then completed)', async () => {
    let remote = 'processing';
    const mock = new MockFetch();
    mock.setFallback((url, init) => {
      if (String(init?.method) === 'PUT') {
        remote = String(JSON.parse(String(init?.body))?.status ?? remote);
        return jsonResponse(200, { id: 5001, status: remote });
      }
      return jsonResponse(200, { id: 5001, status: remote });
    });
    const woo = new WooCommerceProvider(mock.fetch);
    await woo.pushOrderStatus(STORE(), { providerId: '5001' }, 'cancelled');
    await expect(woo.readOrderStatus(STORE(), { providerId: '5001' })).resolves.toEqual({ status: 'cancelled' });
    await woo.pushOrderStatus(STORE(), { providerId: '5001' }, 'completed');
    await expect(woo.readOrderStatus(STORE(), { providerId: '5001' })).resolves.toEqual({ status: 'completed' });
    const puts = mock.calls.filter((c) => c.init?.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(JSON.parse(String(puts[0]?.init?.body))).toEqual({ status: 'cancelled' });
    expect(JSON.parse(String(puts[1]?.init?.body))).toEqual({ status: 'completed' });
  });
});
