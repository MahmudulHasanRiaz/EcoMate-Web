/**
 * Shopify install-callback verification (App URL landing after Install).
 *
 * - HMAC recipe: drop hmac/signature, sort, join key=value, hex HMAC.
 * - Service: unknown shop → 404, bad/stale signature → 401 (generic).
 * - Landing page carries shop/name only — never secrets or tokens.
 */
import { createHmac } from 'crypto';
import { StoresService } from '../../stores.service';
import {
  isInstallTimestampFresh,
  verifyShopifyInstallHmac,
} from '../../providers/webhook-crypto';

const SECRET = 'test-install-secret-fake';

function signedQuery(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    host: 'YWRtaW4uc2hvcGlmeS5jb20',
    shop: 'test-shop.myshopify.com',
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...over,
  };
  const message = Object.keys(base)
    .sort()
    .map((k) => `${k}=${base[k]}`)
    .join('&');
  return {
    ...base,
    hmac: createHmac('sha256', SECRET).update(message).digest('hex'),
  };
}

function buildService(prisma: any) {
  const svc = new StoresService(
    prisma as any,
    {} as any,
    { providerFor: jest.fn() } as any,
  );
  return svc;
}

describe('verifyShopifyInstallHmac (pure)', () => {
  it('accepts a correctly signed query, rejects tampering', () => {
    expect(verifyShopifyInstallHmac(signedQuery(), SECRET)).toBe(true);
    const tampered = signedQuery();
    tampered.shop = 'evil.myshopify.com';
    expect(verifyShopifyInstallHmac(tampered, SECRET)).toBe(false);
    expect(verifyShopifyInstallHmac(signedQuery(), 'wrong-secret-fake')).toBe(false);
    expect(verifyShopifyInstallHmac({ shop: 'x' }, SECRET)).toBe(false);
  });

  it('freshness defaults to a 24h window', () => {
    const now = Date.now();
    expect(isInstallTimestampFresh(String(Math.floor(now / 1000)), now)).toBe(true);
    expect(isInstallTimestampFresh('1', now)).toBe(false);
    expect(isInstallTimestampFresh(undefined, now)).toBe(false);
  });
});

describe('StoresService.verifyInstallCallback', () => {
  const storeRow = {
    id: 'store-install-1',
    kind: 'SHOPIFY',
    name: 'Install Audit',
    domainNormalised: 'test-shop.myshopify.com',
  };

  function prismaWith(store: any) {
    return {
      store: { findFirst: jest.fn().mockResolvedValue(store) },
      storeCredential: {
        findFirst: jest.fn().mockResolvedValue({ credentialsEnc: 'enc:unused' }),
      },
    };
  }

  it('unknown shop → 404 generic', async () => {
    const svc = buildService(prismaWith(null));
    const err = await svc.verifyInstallCallback(signedQuery()).catch((e) => e);
    expect(err?.constructor?.name).toBe('NotFoundException');
  });

  it('bad signature → 401, stale timestamp → 401', async () => {
    const svc = buildService(prismaWith(storeRow));
    // Stub secret loading: service decrypts via encryption — bypass with spy.
    jest.spyOn(svc as any, 'loadSecrets').mockResolvedValue({ clientSecret: SECRET });
    const forged = signedQuery();
    forged.hmac = '0'.repeat(64);
    const bad = await svc.verifyInstallCallback(forged).catch((e) => e);
    expect(bad?.constructor?.name).toBe('UnauthorizedException');
    const stale = await svc
      .verifyInstallCallback(signedQuery({ timestamp: '1' }))
      .catch((e) => e);
    expect(stale?.constructor?.name).toBe('UnauthorizedException');
  });

  it('valid query resolves shop identity with no secret echo', async () => {
    const svc = buildService(prismaWith(storeRow));
    jest.spyOn(svc as any, 'loadSecrets').mockResolvedValue({ clientSecret: SECRET });
    const res = await svc.verifyInstallCallback(signedQuery());
    expect(res).toEqual({
      shop: 'test-shop.myshopify.com',
      storeId: 'store-install-1',
      storeName: 'Install Audit',
    });
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });
});
