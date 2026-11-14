import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  canonicalSiteUrl,
  canonicalDomainFromConfig,
  envSiteUrl,
  siteUrl,
} from '@/lib/site-url';

// Controlled request headers for canonicalSiteUrl: `null` means headers()
// throws (no request context — the build-time prerender case).
let mockHeadersValue: Headers | null = new Headers({ host: 'demo.ecomate.bd' });

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    if (mockHeadersValue === null) throw new Error('headers() called outside a request scope');
    return mockHeadersValue;
  }),
}));

// Controlled storefront config for the Settings-domain tier: `null` means
// the config fetch throws (backend unreachable — fall through the chain).
let mockConfigValue: any = { store: { name: 'Test Store' } };

vi.mock('@/lib/api/storefront-config-server', () => ({
  getStorefrontConfigServer: vi.fn(async () => {
    if (mockConfigValue === null) throw new Error('config unreachable');
    return mockConfigValue;
  }),
}));

const ENV_KEYS = [
  'STORE_NEXT_PUBLIC_STOREFRONT_URL',
  'NEXT_PUBLIC_STOREFRONT_URL',
  'NEXT_PUBLIC_BASE_URL',
] as const;
let savedEnv: Record<string, string | undefined>;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
}

describe('canonicalSiteUrl', () => {
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    mockHeadersValue = new Headers({ host: 'demo.ecomate.bd' });
    mockConfigValue = { store: { name: 'Test Store' } };
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('env unset → request host, https', async () => {
    setEnv({});
    await expect(canonicalSiteUrl()).resolves.toBe('https://demo.ecomate.bd');
  });

  it('env wrong (:3001 / http) → request host wins', async () => {
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'http://www.demo.ecomate.bd:3001' });
    await expect(canonicalSiteUrl()).resolves.toBe('https://demo.ecomate.bd');
  });

  it('x-forwarded-host wins over host (first of the chain)', async () => {
    setEnv({});
    mockHeadersValue = new Headers({
      'x-forwarded-host': 'shop.example.com, proxy.internal',
      host: 'demo.ecomate.bd',
    });
    await expect(canonicalSiteUrl()).resolves.toBe('https://shop.example.com');
  });

  it('localhost keeps http and its port', async () => {
    setEnv({});
    mockHeadersValue = new Headers({ host: 'localhost:3000' });
    await expect(canonicalSiteUrl()).resolves.toBe('http://localhost:3000');
  });

  it('a port on a public host is dropped (internal :3001 leaking through)', async () => {
    setEnv({});
    mockHeadersValue = new Headers({ host: 'demo.ecomate.bd:3001' });
    await expect(canonicalSiteUrl()).resolves.toBe('https://demo.ecomate.bd');
  });

  it('no request context + valid env → env', async () => {
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'https://shop.example.com' });
    mockHeadersValue = null;
    await expect(canonicalSiteUrl()).resolves.toBe('https://shop.example.com');
  });

  it('no request context + env unset → build-time placeholder only', async () => {
    setEnv({});
    mockHeadersValue = null;
    await expect(canonicalSiteUrl()).resolves.toBe('https://example.com');
  });

  it('no request context + env wrong → placeholder, never the wrong env', async () => {
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'http://www.demo.ecomate.bd:3001' });
    mockHeadersValue = null;
    await expect(canonicalSiteUrl()).resolves.toBe('https://example.com');
  });

  it('never emits https://example.com at runtime (request host present)', async () => {
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'https://example.com' });
    await expect(canonicalSiteUrl()).resolves.toBe('https://demo.ecomate.bd');
  });

  it('Settings domain wins over the request host', async () => {
    setEnv({});
    mockConfigValue = { canonicalDomain: 'https://shop.example.com' };
    await expect(canonicalSiteUrl()).resolves.toBe('https://shop.example.com');
  });

  it('Settings domain wins over a spoofed x-forwarded-host', async () => {
    setEnv({});
    mockConfigValue = { canonicalDomain: 'https://shop.example.com' };
    mockHeadersValue = new Headers({
      'x-forwarded-host': 'evil.example.net',
      host: 'demo.ecomate.bd',
    });
    await expect(canonicalSiteUrl()).resolves.toBe('https://shop.example.com');
  });

  it('no request context + Settings domain set → Settings domain, not the placeholder', async () => {
    setEnv({});
    mockHeadersValue = null;
    mockConfigValue = { canonicalDomain: 'https://shop.example.com/' };
    await expect(canonicalSiteUrl()).resolves.toBe('https://shop.example.com');
  });

  it('invalid Settings domain falls through to the request host', async () => {
    setEnv({});
    mockConfigValue = { canonicalDomain: 'http://shop.example.com:3001' };
    await expect(canonicalSiteUrl()).resolves.toBe('https://demo.ecomate.bd');
  });

  it('unreachable Settings config falls through to the request host', async () => {
    setEnv({});
    mockConfigValue = null;
    await expect(canonicalSiteUrl()).resolves.toBe('https://demo.ecomate.bd');
  });
});

describe('canonicalDomainFromConfig', () => {
  it('accepts a valid domain, trailing slash stripped', () => {
    expect(
      canonicalDomainFromConfig({ canonicalDomain: 'https://shop.example.com/' }),
    ).toBe('https://shop.example.com');
  });

  it('rejects absent, empty, non-string and invalid values', () => {
    expect(canonicalDomainFromConfig({})).toBe('');
    expect(canonicalDomainFromConfig(null)).toBe('');
    expect(canonicalDomainFromConfig({ canonicalDomain: '' })).toBe('');
    expect(canonicalDomainFromConfig({ canonicalDomain: 42 })).toBe('');
    expect(canonicalDomainFromConfig({ canonicalDomain: 'http://shop.example.com' })).toBe('');
    expect(canonicalDomainFromConfig({ canonicalDomain: 'https://shop.example.com:3001' })).toBe('');
    expect(canonicalDomainFromConfig({ canonicalDomain: 'https://example.com' })).toBe('');
    expect(canonicalDomainFromConfig({ canonicalDomain: 'https://backend:4000' })).toBe('');
  });
});

describe('envSiteUrl', () => {
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('accepts a public https URL with no port', () => {
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'https://shop.example.com/' });
    expect(envSiteUrl()).toBe('https://shop.example.com');
  });

  it('rejects http, ports, internal hosts and example.com', () => {
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'http://shop.example.com' });
    expect(envSiteUrl()).toBe('');
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'https://shop.example.com:3001' });
    expect(envSiteUrl()).toBe('');
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'https://backend:4000' });
    expect(envSiteUrl()).toBe('');
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'https://example.com' });
    expect(envSiteUrl()).toBe('');
  });

  it('falls back to the legacy NEXT_PUBLIC_BASE_URL', () => {
    setEnv({ NEXT_PUBLIC_BASE_URL: 'https://legacy.example.com' });
    expect(envSiteUrl()).toBe('https://legacy.example.com');
  });

  it('accepts the runtime STORE_ var (read at runtime, never build-inlined)', () => {
    setEnv({ STORE_NEXT_PUBLIC_STOREFRONT_URL: 'https://runtime.example.com' });
    expect(envSiteUrl()).toBe('https://runtime.example.com');
  });

  it('runtime STORE_ var wins over the build-baked NEXT_PUBLIC_ var', () => {
    setEnv({
      STORE_NEXT_PUBLIC_STOREFRONT_URL: 'https://runtime.example.com',
      NEXT_PUBLIC_STOREFRONT_URL: 'https://baked.example.com',
    });
    expect(envSiteUrl()).toBe('https://runtime.example.com');
  });

  it('invalid runtime STORE_ var falls through to NEXT_PUBLIC_', () => {
    setEnv({
      STORE_NEXT_PUBLIC_STOREFRONT_URL: 'http://runtime.example.com:3001',
      NEXT_PUBLIC_STOREFRONT_URL: 'https://baked.example.com',
    });
    expect(envSiteUrl()).toBe('https://baked.example.com');
  });
});

describe('siteUrl (unchanged sync behaviour)', () => {
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('returns the raw env value (media-URL callers rely on it)', () => {
    setEnv({ NEXT_PUBLIC_STOREFRONT_URL: 'http://www.demo.ecomate.bd:3001/' });
    expect(siteUrl()).toBe('http://www.demo.ecomate.bd:3001');
    setEnv({});
    expect(siteUrl()).toBe('');
  });
});
