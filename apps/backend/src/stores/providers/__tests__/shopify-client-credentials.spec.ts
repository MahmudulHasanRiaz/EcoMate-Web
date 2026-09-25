/**
 * Shopify Client Credentials Grant — central-commerce P9 (Issue 2).
 *
 * Per current Shopify docs the legacy admin-created custom-app static token
 * is no longer creatable. Auth is per-store {shop, clientId, clientSecret} →
 * POST https://{shop}/admin/oauth/access_token (form-urlencoded
 * `grant_type=client_credentials`) → `{access_token, expires_in (always
 * 86399), scope}` → `X-Shopify-Access-Token`.
 *
 * Vectors: exchange shape + cache reuse, 60s early refresh, 401 → ONE
 * re-exchange + retry (then classify, never a loop), org-mismatch
 * (`invalid_client`/`shop_not_permitted`) PERMANENT with the Dev Dashboard
 * constraint in the error text, TEMPORARY exchange failure retryable,
 * concurrent coalescing (single flight), per-store isolation (one store's
 * token never used for another), legacy static `accessToken` → explicit
 * INVALID_REQUEST (never silently used), HMAC via
 * `webhookSecret ?? clientSecret`. All fixtures obviously-fake.
 */
import {
  ProviderError,
  ProviderErrorCategory,
} from '../../../marketing/ad-provider.adapter';
import { ShopifyProvider } from '../shopify.provider';
import { classifyProviderError } from '../retry-classifier';
import {
  MockFetch,
  SHOPIFY_FAKE_ACCESS_TOKEN,
  buildShopifyDelivery,
  buildStoreUnit,
  jsonResponse,
  mockShopifyTokenEndpoint,
} from './fixtures';

const STORE = () => buildStoreUnit('SHOPIFY');
const SHOP = 'test-shop.myshopify.com';
const TOKEN_URL = `https://${SHOP}/admin/oauth/access_token`;

const tokenCalls = (mock: MockFetch) =>
  mock.calls.filter((c) => c.url === TOKEN_URL);

describe('Shopify Client Credentials Grant (Issue 2)', () => {
  it('exchanges form-urlencoded grant_type=client_credentials, then reuses the cached bearer', async () => {
    const mock = new MockFetch();
    mockShopifyTokenEndpoint(mock);
    mock.onAll(() =>
      jsonResponse(200, { product: { id: 9001, variants: [{ inventory_quantity: 2 }] } }),
    );
    const shopify = new ShopifyProvider(mock.fetch);
    await expect(
      shopify.readStockState(STORE(), { providerId: '9001' }),
    ).resolves.toBe('IN_STOCK');
    await expect(
      shopify.readStockState(STORE(), { providerId: '9001' }),
    ).resolves.toBe('IN_STOCK');
    // One exchange for two API calls (cached bearer).
    expect(tokenCalls(mock)).toHaveLength(1);
    const exchange = tokenCalls(mock)[0]!;
    expect(exchange.init?.method).toBe('POST');
    expect(exchange.init?.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const params = new URLSearchParams(String(exchange.init?.body ?? ''));
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('client_id')).toBe('test-client-id-fake');
    expect(params.get('client_secret')).toBe('test-client-secret-fake');
    // The minted bearer rides the Admin API calls.
    const api = mock.calls.filter((c) => c.url !== TOKEN_URL);
    expect(api).toHaveLength(2);
    for (const call of api) {
      expect(call.init?.headers).toMatchObject({
        'X-Shopify-Access-Token': SHOPIFY_FAKE_ACCESS_TOKEN,
      });
    }
  });

  it('early refresh: a token expiring within 60s is re-exchanged, never shipped stale', async () => {
    const mock = new MockFetch();
    let n = 0;
    mock.onPrefix(TOKEN_URL, () => {
      n += 1;
      return jsonResponse(200, {
        access_token: `tok-${n}`,
        expires_in: 50, // inside the 60s early-refresh window
        scope: 'write_products,write_inventory,write_orders',
      });
    });
    mock.onAll(() =>
      jsonResponse(200, { product: { id: 9001, variants: [{ inventory_quantity: 1 }] } }),
    );
    const shopify = new ShopifyProvider(mock.fetch);
    await shopify.readStockState(STORE(), { providerId: '9001' });
    await shopify.readStockState(STORE(), { providerId: '9001' });
    expect(tokenCalls(mock)).toHaveLength(2);
    const bearers = mock.calls
      .filter((c) => c.url !== TOKEN_URL)
      .map((c) => (c.init?.headers as Record<string, string>)['X-Shopify-Access-Token']);
    expect(bearers).toEqual(['tok-1', 'tok-2']);
  });

  it('401 → ONE re-exchange + retry, then success (never a loop)', async () => {
    const mock = new MockFetch();
    let tokens = 0;
    mock.onPrefix(TOKEN_URL, () => {
      tokens += 1;
      return jsonResponse(200, {
        access_token: `tok-${tokens}`,
        expires_in: 86399,
        scope: 'write_products,write_inventory,write_orders',
      });
    });
    let gets = 0;
    mock.setFallback((url, init) => {
      if (url.includes('/products/9001.json')) {
        gets += 1;
        if (gets === 1) return jsonResponse(401, { errors: 'unauthorized' });
        return jsonResponse(200, {
          product: { id: 9001, variants: [{ inventory_quantity: 4 }] },
        });
      }
      return jsonResponse(404, {});
    });
    const shopify = new ShopifyProvider(mock.fetch);
    await expect(
      shopify.readStockState(STORE(), { providerId: '9001' }),
    ).resolves.toBe('IN_STOCK');
    expect(tokens).toBe(2); // initial exchange + exactly one re-exchange
    expect(gets).toBe(2); // initial GET + exactly one retry
    const bearers = mock.calls
      .filter((c) => c.url.includes('/products/9001.json'))
      .map((c) => (c.init?.headers as Record<string, string>)['X-Shopify-Access-Token']);
    expect(bearers).toEqual(['tok-1', 'tok-2']);
    void tokens;
  });

  it('401 on the retry classifies AUTHENTICATION_FAILED with exactly one re-exchange', async () => {
    const mock = new MockFetch();
    mockShopifyTokenEndpoint(mock);
    mock.onAll(() => jsonResponse(401, { errors: 'unauthorized' }));
    const shopify = new ShopifyProvider(mock.fetch);
    const err = await shopify
      .readStockState(STORE(), { providerId: '9001' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.category).toBe(ProviderErrorCategory.AUTHENTICATION_FAILED);
    expect(tokenCalls(mock)).toHaveLength(2);
    expect(classifyProviderError(err).retryable).toBe(false);
  });

  it('org mismatch (invalid_client/shop_not_permitted) is PERMANENT with the Dev Dashboard constraint, no retry', async () => {
    const mock = new MockFetch();
    mockShopifyTokenEndpoint(mock, {
      status: 400,
      body: { error: 'invalid_client', error_description: 'shop_not_permitted for this app' },
    });
    mock.onAll(() => jsonResponse(200, {}));
    const shopify = new ShopifyProvider(mock.fetch);
    const err = await shopify
      .readStockState(STORE(), { providerId: '9001' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.category).toBe(ProviderErrorCategory.INVALID_REQUEST);
    expect(String(err.message)).toMatch(/same Shopify Dev Dashboard organization/);
    expect(classifyProviderError(err).retryable).toBe(false);
    expect(tokenCalls(mock)).toHaveLength(1); // no retry loop
    // The client secret is never echoed in the error.
    expect(String(err.message)).not.toContain('test-client-secret-fake');
  });

  it('exchange 500 is TEMPORARY (retryable); testConnection maps it to unreachable data, never a throw', async () => {
    const mock = new MockFetch();
    mockShopifyTokenEndpoint(mock, { status: 500, body: { error: 'server_error' } });
    mock.onAll(() => jsonResponse(200, { shop: {} }));
    const shopify = new ShopifyProvider(mock.fetch);
    const err = await shopify
      .readStockState(STORE(), { providerId: '9001' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.category).toBe(ProviderErrorCategory.TEMPORARY_FAILURE);
    expect(classifyProviderError(err).retryable).toBe(true);
    await expect(
      new ShopifyProvider(mock.fetch).testConnection(STORE()),
    ).resolves.toMatchObject({
      reachable: false,
      authenticated: false,
      permissionsOk: false,
    });
  });

  it('concurrent callers coalesce onto a single exchange (single flight)', async () => {
    const mock = new MockFetch();
    let exchanges = 0;
    mock.onPrefix(TOKEN_URL, async () => {
      exchanges += 1;
      await new Promise((r) => setTimeout(r, 25));
      return jsonResponse(200, {
        access_token: SHOPIFY_FAKE_ACCESS_TOKEN,
        expires_in: 86399,
        scope: 'write_products,write_inventory,write_orders',
      });
    });
    mock.onAll(() =>
      jsonResponse(200, { product: { id: 9001, variants: [{ inventory_quantity: 1 }] } }),
    );
    const shopify = new ShopifyProvider(mock.fetch);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        shopify.readStockState(STORE(), { providerId: '9001' }),
      ),
    );
    expect(results).toEqual(['IN_STOCK', 'IN_STOCK', 'IN_STOCK', 'IN_STOCK', 'IN_STOCK']);
    expect(exchanges).toBe(1);
  });

  it('per-store isolation: one store\u2019s token is never used for another', async () => {
    const mock = new MockFetch();
    mock.onPrefix(TOKEN_URL, (url, init) => {
      const params = new URLSearchParams(String(init?.body ?? ''));
      return jsonResponse(200, {
        access_token: `tok-for-${params.get('client_id')}`,
        expires_in: 86399,
        scope: 'write_products,write_inventory,write_orders',
      });
    });
    mock.onAll(() =>
      jsonResponse(200, { product: { id: 1, variants: [{ inventory_quantity: 1 }] } }),
    );
    const shopify = new ShopifyProvider(mock.fetch);
    const storeA = buildStoreUnit('SHOPIFY', {
      id: 'store-shopify-A',
      secrets: { clientId: 'id-A-fake', clientSecret: 'secret-A-fake' },
    });
    const storeB = buildStoreUnit('SHOPIFY', {
      id: 'store-shopify-B',
      secrets: { clientId: 'id-B-fake', clientSecret: 'secret-B-fake' },
    });
    await shopify.readStockState(storeA, { providerId: '1' });
    await shopify.readStockState(storeB, { providerId: '1' });
    await shopify.readStockState(storeA, { providerId: '1' }); // cache hit
    expect(tokenCalls(mock)).toHaveLength(2); // one exchange per store
    const bearers = mock.calls
      .filter((c) => !c.url.includes('/oauth/access_token'))
      .map((c) => (c.init?.headers as Record<string, string>)['X-Shopify-Access-Token']);
    expect(bearers).toEqual(['tok-for-id-A-fake', 'tok-for-id-B-fake', 'tok-for-id-A-fake']);
  });

  it('legacy static accessToken → explicit INVALID_REQUEST, zero HTTP calls (never silently used)', async () => {
    const legacy = buildStoreUnit('SHOPIFY', {
      secrets: {
        shop: 'test-shop.myshopify.com',
        accessToken: 'shpat_legacy_token',
        clientId: 'test-client-id-fake',
        clientSecret: 'test-client-secret-fake',
      },
    });
    const mock = new MockFetch();
    mock.onAll(() => jsonResponse(200, {}));
    const shopify = new ShopifyProvider(mock.fetch);
    const restErr = await shopify
      .readStockState(legacy, { providerId: '9001' })
      .catch((e) => e);
    expect(restErr).toBeInstanceOf(ProviderError);
    expect(restErr.category).toBe(ProviderErrorCategory.INVALID_REQUEST);
    expect(String(restErr.message)).toMatch(/client credentials required/);
    await expect(shopify.testConnection(legacy)).rejects.toThrow(
      /client credentials required/,
    );
    expect(mock.calls).toHaveLength(0);
  });

  it('HMAC secret = webhookSecret ?? clientSecret; absent both → no-secret-configured', () => {
    const provider = new ShopifyProvider();
    const payload = { id: 5001 };
    // Fixture carries no webhookSecret → clientSecret signs and verifies.
    const viaClient = buildShopifyDelivery('test-client-secret-fake', payload);
    expect(
      provider.verifyWebhook(STORE(), viaClient.headers, viaClient.rawBody),
    ).toMatchObject({ valid: true, deliveryId: 'shopify-delivery-1' });
    const wrong = buildShopifyDelivery('wrong-secret-fake', payload);
    expect(provider.verifyWebhook(STORE(), wrong.headers, wrong.rawBody)).toEqual({
      valid: false,
      reason: 'bad-signature',
    });
    // An explicit webhookSecret still wins when present.
    const explicit = buildStoreUnit('SHOPIFY', {
      secrets: {
        shop: 'test-shop.myshopify.com',
        clientId: 'test-client-id-fake',
        clientSecret: 'test-client-secret-fake',
        webhookSecret: 'explicit-webhook-fake',
      },
    });
    const d = buildShopifyDelivery('explicit-webhook-fake', payload);
    expect(provider.verifyWebhook(explicit, d.headers, d.rawBody).valid).toBe(true);
    expect(
      provider.verifyWebhook(explicit, viaClient.headers, viaClient.rawBody),
    ).toEqual({ valid: false, reason: 'bad-signature' });
    // Neither configured → explicit reason, never a throw.
    const secretless = buildStoreUnit('SHOPIFY', {
      secrets: { shop: 'x.myshopify.com', clientId: '', clientSecret: '' },
    });
    expect(provider.verifyWebhook(secretless, viaClient.headers, viaClient.rawBody)).toEqual({
      valid: false,
      reason: 'no-secret-configured',
    });
  });
});
