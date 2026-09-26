/**
 * Keyed webhook registration — central-commerce P9 (Issue 1).
 *
 * The receivers REQUIRE `:storeKey`
 * (`POST /api/webhooks/stores/{woocommerce,shopify,custom}/:storeKey` —
 * `store-webhooks.controller.ts`; intake resolves
 * `prisma.store.findUnique({ where: { id: storeKey } })` and rejects
 * unknown/disconnected/NATIVE with a generic 401). All three adapters must
 * therefore register WITH the canonical public storeKey (`store.id`).
 *
 * Vectors (MockFetch): (1) the registered URL contains the correct
 * storeKey; (2) it resolves to the receiver route shape
 * `/api/webhooks/stores/<slug>/:storeKey`. Nothing else in registration
 * changes: topics, `format: 'json'` and the `api_version` pin stay.
 */
import {
  BRIDGE_WEBHOOK_TOPICS,
  CustomBridgeProvider,
} from '../custom-bridge.provider';
import {
  SHOPIFY_API_VERSION,
  SHOPIFY_WEBHOOK_TOPICS,
  ShopifyProvider,
} from '../shopify.provider';
import { WooCommerceProvider } from '../woocommerce.provider';
import {
  MockFetch,
  buildStoreUnit,
  jsonResponse,
  mockShopifyTokenEndpoint,
} from './fixtures';
import { ReferenceBridge } from './reference-bridge';

const BASE = 'https://api.example.test';

/** Receiver route shape per slug (mirrors store-webhooks.controller.ts). */
function receiverShape(slug: 'woocommerce' | 'shopify' | 'custom', storeKey: string): string {
  return `/api/webhooks/stores/${slug}/${storeKey}`;
}

describe('keyed webhook registration (Issue 1)', () => {
  it('woocommerce registers delivery_url WITH the storeKey', async () => {
    const mock = new MockFetch();
    const posted: unknown[] = [];
    mock.setFallback((url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse(200, []);
      posted.push(JSON.parse(String(init?.body ?? '{}')));
      return jsonResponse(201, { id: 7 });
    });
    const store = buildStoreUnit('WOOCOMMERCE');
    const res = await new WooCommerceProvider(mock.fetch).ensureWebhooks(store, `${BASE}/`);
    expect(res).toEqual({
      ok: true,
      topics: ['order.created', 'order.updated', 'product.updated'],
    });
    expect(posted).toHaveLength(3);
    for (const body of posted) {
      expect(body).toMatchObject({
        delivery_url: `${BASE}${receiverShape('woocommerce', store.id)}`,
      });
    }
  });

  it('shopify registers address WITH the storeKey; topics/format unchanged, no api_version (API rejects it)', async () => {
    const mock = new MockFetch();
    mockShopifyTokenEndpoint(mock);
    const created: unknown[] = [];
    mock.setFallback((url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return jsonResponse(200, { webhooks: [] });
      }
      created.push(JSON.parse(String(init?.body ?? '{}')));
      return jsonResponse(201, { webhook: { id: 9 } });
    });
    const store = buildStoreUnit('SHOPIFY');
    const res = await new ShopifyProvider(mock.fetch).ensureWebhooks(store, BASE);
    expect(res).toEqual({ ok: true, topics: SHOPIFY_WEBHOOK_TOPICS });
    expect(created).toHaveLength(SHOPIFY_WEBHOOK_TOPICS.length);
    const topics = (created as any[]).map((b) => b.webhook.topic).sort();
    expect(topics).toEqual([...SHOPIFY_WEBHOOK_TOPICS].sort());
    for (const body of created) {
      expect(body).toMatchObject({
        webhook: {
          address: `${BASE}${receiverShape('shopify', store.id)}`,
          format: 'json',
        },
      });
      expect((body as any).webhook.api_version).toBeUndefined();
    }
  });

  it('custom bridge registers url WITH the storeKey; topics unchanged', async () => {
    const bridge = new ReferenceBridge();
    const mock = new MockFetch();
    mock.onPrefix(bridge.baseUrl, bridge.handle);
    const store = buildStoreUnit('CUSTOM');
    const res = await new CustomBridgeProvider(mock.fetch).ensureWebhooks(store, `${BASE}/`);
    expect(res).toEqual({ ok: true, topics: BRIDGE_WEBHOOK_TOPICS });
    expect(bridge.webhooks.map((w) => w.topic).sort()).toEqual(
      [...BRIDGE_WEBHOOK_TOPICS].sort(),
    );
    for (const w of bridge.webhooks) {
      expect(w.url).toBe(`${BASE}${receiverShape('custom', store.id)}`);
    }
  });

  it('registered URLs resolve to the receiver route shape for every slug', () => {
    for (const slug of ['woocommerce', 'shopify', 'custom'] as const) {
      const storeKey = 'store-uuid-key-1';
      const path = receiverShape(slug, storeKey);
      // Controller routes: POST /webhooks/stores/<slug>/:storeKey under the
      // global `api` prefix → /api/webhooks/stores/<slug>/<storeKey>.
      expect(path).toMatch(new RegExp(`^/api/webhooks/stores/${slug}/[^/]+$`));
      expect(path.split('/').pop()).toBe(storeKey);
    }
  });
});
