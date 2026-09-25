/**
 * P9 secret-leak audit — 12th smoke item (static part).
 *
 * Asserts across the stores surface (reads, thrown errors, webhook
 * registrations, issue-adjacent payloads, SyncRun-adjacent notes,
 * test-connection responses):
 * - sanitized store reads contain no secret-shaped values;
 * - error messages for missing/bad credentials are generic (field names at
 *   most — never credential VALUES);
 * - testConnection responses never echo credentials.
 *
 * All fixtures use obviously-fake placeholders (`test-token-…`) — no real or
 * real-shaped secret appears anywhere in this file.
 */
import { StoresService } from './stores.service';
import { WooCommerceProvider } from './providers/woocommerce.provider';
import { ShopifyProvider } from './providers/shopify.provider';
import { CustomBridgeProvider } from './providers/custom-bridge.provider';

const FAKE = {
  consumerKey: 'test-token-consumer-key',
  consumerSecret: 'test-token-consumer-secret',
  accessToken: 'test-token-shopify-access',
  clientId: 'test-token-client-id',
  clientSecret: 'test-token-client-secret',
  bridgeKey: 'test-token-bridge-key',
  webhookSecret: 'test-token-webhook-secret',
  baseUrl: 'https://test-token-store.example.com',
} as const;

/** Keys that must never appear with a value on a sanitized read. */
const SECRET_SHAPED_KEYS = [
  'consumerKey',
  'consumerSecret',
  'accessToken',
  'clientId',
  'clientSecret',
  'bridgeKey',
  'webhookSecret',
  'credentials',
  'credentialsEnc',
] as const;

function serializedLeak(value: unknown): string | null {
  const s = JSON.stringify(value ?? null);
  for (const token of Object.values(FAKE)) {
    if (token.length > 0 && s.includes(token)) return token;
  }
  return null;
}

function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // A numeric `_count.credentials` (a row COUNT) is not a secret — only
      // string/object payloads under a secret-shaped key count as a leak.
      if (SECRET_SHAPED_KEYS.includes(k as (typeof SECRET_SHAPED_KEYS)[number]) && typeof v === 'number') {
        continue;
      }
      into.add(k);
      collectKeys(v, into);
    }
  }
}

function secretKeysPresent(value: unknown): string[] {
  const keys = new Set<string>();
  collectKeys(value, keys);
  return SECRET_SHAPED_KEYS.filter((k) => keys.has(k));
}

function buildService(prisma: any, provider?: any) {
  const encryption: any = {
    encrypt: jest.fn((s: string) => `enc:${s}`),
    decrypt: jest.fn((s: string) => String(s).replace(/^enc:/, '')),
  };
  const registry: any = {
    providerFor: jest.fn(() => provider ?? new WooCommerceProvider()),
  };
  const svc = new StoresService(prisma as any, encryption as any, registry as any);
  return { svc, prisma, encryption, registry };
}

const baseStore = (over: any = {}) => ({
  id: 'store-p9-audit',
  kind: 'WOOCOMMERCE',
  name: 'Audit Store',
  domainNormalised: 'test-token-store.example.com',
  settings: {},
  status: 'PENDING',
  healthState: 'DISCONNECTED',
  ...over,
});

describe('P9 secret-leak audit', () => {
  describe('sanitized store reads contain no secret-shaped values', () => {
    it('list() strips credentials/credentialsEnc even when the row carries them', async () => {
      const prisma: any = {
        store: {
          findMany: jest.fn().mockResolvedValue([
            {
              ...baseStore(),
              credentials: [{ id: 'cred-1' }],
              credentialsEnc: `enc:${FAKE.consumerSecret}`,
              _count: { credentials: 1, healthChecks: 0 },
            },
          ]),
        },
      };
      const { svc } = buildService(prisma);
      const rows = (await svc.list()) as any[];
      expect(rows).toHaveLength(1);
      expect(secretKeysPresent(rows[0])).toEqual([]);
      expect(serializedLeak(rows[0])).toBeNull();
      // The credential COUNT (a number) survives sanitizing — the values do not.
      expect(rows[0]._count).toEqual({ credentials: 1, healthChecks: 0 });
    });

    it('detail() strips secret-shaped keys and values', async () => {
      const prisma: any = {
        store: {
          findUnique: jest.fn().mockResolvedValue({
            ...baseStore(),
            credentials: [{ id: 'cred-1' }],
            credentialsEnc: `enc:${FAKE.consumerKey}:${FAKE.consumerSecret}`,
          }),
        },
      };
      const { svc } = buildService(prisma);
      const row = (await svc.detail('store-p9-audit')) as any;
      expect(secretKeysPresent(row)).toEqual([]);
      expect(serializedLeak(row)).toBeNull();
    });

    it('update() persists syncScope but the returned row carries no secrets', async () => {
      const stored = baseStore({ settings: { mediaProbeUrl: 'https://cdn.example.com/probe' } });
      const prisma: any = {
        store: {
          findUnique: jest.fn().mockResolvedValue(stored),
          update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...stored, ...data })),
        },
      };
      const { svc } = buildService(prisma);
      const row = (await svc.update('store-p9-audit', {
        syncScope: { products: true, orders: true, stock: false },
      } as any)) as any;
      expect(prisma.store.update).toHaveBeenCalledTimes(1);
      const written = prisma.store.update.mock.calls[0][0].data;
      expect(written.settings.syncScope).toEqual({ products: true, orders: true, stock: false });
      expect(written.settings.initialSyncPolicy).toBe('adopt_existing');
      // Unrelated settings keys survive the merge (no wholesale replace).
      expect(written.settings.mediaProbeUrl).toBe('https://cdn.example.com/probe');
      expect(secretKeysPresent(row)).toEqual([]);
      expect(serializedLeak(row)).toBeNull();
    });

    it('rotateCredentials() acknowledges rotation without echoing the payload', async () => {
      const prisma: any = {
        store: { findUnique: jest.fn().mockResolvedValue(baseStore()) },
        storeCredential: {
          create: jest.fn().mockResolvedValue({ rotatedAt: new Date(0), keyFingerprint: 'default-key' }),
        },
      };
      const { svc } = buildService(prisma);
      const res = (await svc.rotateCredentials('store-p9-audit', {
        credentials: { consumerKey: FAKE.consumerKey, consumerSecret: FAKE.consumerSecret },
      })) as any;
      expect(secretKeysPresent(res)).toEqual([]);
      expect(serializedLeak(res)).toBeNull();
      expect(res.storeId).toBe('store-p9-audit');
    });
  });

  describe('error messages for missing/bad credentials are generic', () => {
    it.each([
      ['woocommerce', () => new WooCommerceProvider()],
      ['shopify', () => new ShopifyProvider()],
      ['custom', () => new CustomBridgeProvider()],
    ])('%s: missing-credential throw names fields, never values', async (_slug, make) => {
      const provider = make() as any;
      // A live-shaped call that must pass ctxOf first (values are fake but present).
      const failingCall = async () => {
        if (_slug === 'woocommerce') {
          return provider.readStockState(
            { id: 's', kind: 'WOOCOMMERCE', settings: {}, secrets: { consumerKey: FAKE.consumerKey } },
            { providerId: 'test-token-product' },
          );
        }
        if (_slug === 'shopify') {
          return provider.readStockState(
            { id: 's', kind: 'SHOPIFY', settings: {}, secrets: { shop: 'test-token-shop.myshopify.com' } },
            { providerId: 'test-token-product' },
          );
        }
        return provider.readStockState(
          { id: 's', kind: 'CUSTOM', settings: {}, secrets: { baseUrl: FAKE.baseUrl } },
          { providerId: 'test-token-product' },
        );
      };
      await expect(failingCall()).rejects.toThrow();
      const err = await failingCall().catch((e: any) => e);
      expect(serializedLeak(err?.message ?? String(err))).toBeNull();
    });

    it('wrong-secret webhook verification returns a reason code, never the secret', () => {
      const cases: Array<{ provider: any; headers: any; body: Buffer; kind: string }> = [
        {
          provider: new WooCommerceProvider(),
          headers: { 'X-WC-Webhook-Signature': 'test-token-wrong-signature' },
          body: Buffer.from('{"id":"test-token-order"}', 'utf8'),
          kind: 'WOOCOMMERCE',
        },
        {
          provider: new ShopifyProvider(),
          headers: {
            'X-Shopify-Hmac-Sha256': 'test-token-wrong-signature',
            'X-Shopify-Webhook-Id': 'test-token-delivery',
          },
          body: Buffer.from('{"id":"test-token-order"}', 'utf8'),
          kind: 'SHOPIFY',
        },
        {
          provider: new CustomBridgeProvider(),
          headers: {
            'X-EcoMate-Signature': 'test-token-wrong-signature',
            'X-EcoMate-Delivery-Id': 'test-token-delivery',
            'X-EcoMate-Timestamp': String(Math.floor(Date.now() / 1000)),
          },
          body: Buffer.from('{"id":"test-token-order"}', 'utf8'),
          kind: 'CUSTOM',
        },
      ];
      for (const c of cases) {
        const res = c.provider.verifyWebhook(
          { id: 's', kind: c.kind, settings: {}, secrets: { webhookSecret: FAKE.webhookSecret } },
          c.headers,
          c.body,
        );
        expect(res.valid).toBe(false);
        expect(serializedLeak(res)).toBeNull();
      }
    });
  });

  describe('testConnection responses never echo credentials', () => {
    it('service passthrough carries no credential values and stores nothing', async () => {
      const probeResult = {
        reachable: true,
        authenticated: true,
        permissionsOk: true,
        providerStoreId: 'test-token-provider-store',
        capabilities: { products: true },
      };
      const mockProvider: any = { testConnection: jest.fn().mockResolvedValue(probeResult) };
      const prisma: any = {
        store: {
          findUnique: jest.fn().mockResolvedValue(baseStore()),
          update: jest.fn().mockResolvedValue(baseStore()),
        },
        storeCredential: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        storeHealthCheck: { create: jest.fn().mockResolvedValue({}) },
      };
      const { svc } = buildService(prisma, mockProvider);
      const res = (await svc.testConnection('store-p9-audit', {
        credentials: {
          baseUrl: FAKE.baseUrl,
          consumerKey: FAKE.consumerKey,
          consumerSecret: FAKE.consumerSecret,
        },
      })) as any;
      expect(res).toEqual(probeResult);
      expect(secretKeysPresent(res)).toEqual([]);
      expect(serializedLeak(res)).toBeNull();
      // A probe never writes a credential row.
      expect(prisma.storeCredential.create).not.toHaveBeenCalled();
    });

    it('provider missing-credential probes return data (no throw, no echo)', async () => {
      const woo = new WooCommerceProvider();
      const shopify = new ShopifyProvider();
      const custom = new CustomBridgeProvider();
      const results = await Promise.all([
        woo.testConnection({ id: 's', kind: 'WOOCOMMERCE', settings: {}, secrets: {} }),
        shopify.testConnection({ id: 's', kind: 'SHOPIFY', settings: {}, secrets: {} }),
        custom.testConnection({ id: 's', kind: 'CUSTOM', settings: {}, secrets: {} }),
      ]);
      for (const r of results) {
        expect(r.authenticated).toBe(false);
        expect(secretKeysPresent(r)).toEqual([]);
        expect(serializedLeak(r)).toBeNull();
      }
    });

    it('webhook registration results carry topics only — no secrets', async () => {
      const woo = new WooCommerceProvider();
      (woo as any).setFetchFn(async () => ({
        status: 200,
        ok: true,
        json: async () => [],
        text: async () => '[]',
      }));
      const res = await woo.ensureWebhooks(
        {
          id: 's',
          kind: 'WOOCOMMERCE',
          settings: {},
          secrets: {
            baseUrl: FAKE.baseUrl,
            consumerKey: FAKE.consumerKey,
            consumerSecret: FAKE.consumerSecret,
            webhookSecret: FAKE.webhookSecret,
          },
        },
        'https://api.example.com',
      );
      expect(res.ok).toBe(true);
      expect(secretKeysPresent(res)).toEqual([]);
      expect(serializedLeak(res)).toBeNull();
    });
  });
});
