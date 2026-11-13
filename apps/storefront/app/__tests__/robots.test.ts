import { describe, it, expect, vi, beforeEach } from 'vitest';
import robots from '@/app/robots';

process.env.NEXT_PUBLIC_BASE_URL = 'https://example.com';

vi.mock('@/lib/api/storefront-config-server', () => ({
  getStorefrontConfigServer: vi.fn(),
}));

import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';

const mockConfig = getStorefrontConfigServer as unknown as ReturnType<typeof vi.fn>;

describe('robots (4.4, F4)', () => {
  beforeEach(() => {
    mockConfig.mockReset();
  });

  it('disallows private pages (no trailing slash — prefix covers the page itself) and references the sitemap', async () => {
    mockConfig.mockResolvedValue({ searchIndexingEnabled: true });
    const r = await robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : (r.rules as any);
    for (const p of ['/account', '/admin', '/checkout', '/cart', '/orders', '/wishlist']) {
      expect(rules.disallow).toContain(p);
    }
    expect(r.sitemap).toBe('https://example.com/sitemap.xml');
  });

  it('uses NEXT_PUBLIC_STOREFRONT_URL for the sitemap line when set (F3)', async () => {
    mockConfig.mockResolvedValue({ searchIndexingEnabled: true });
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://test.local';
    try {
      expect((await robots()).sitemap).toBe('https://test.local/sitemap.xml');
    } finally {
      delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
    }
  });

  it('flag OFF (fresh tenant): Disallow / for every agent and no sitemap reference', async () => {
    mockConfig.mockResolvedValue({ searchIndexingEnabled: false });
    const r = await robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : (r.rules as any);
    expect(rules.userAgent).toBe('*');
    expect(rules.disallow).toEqual(['/']);
    expect(rules.allow).toBeUndefined();
    expect(r.sitemap).toBeUndefined();
  });

  it('flag ON: allow / with the private-page disallow list and the sitemap reference', async () => {
    mockConfig.mockResolvedValue({ searchIndexingEnabled: true });
    const r = await robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : (r.rules as any);
    expect(rules.allow).toBe('/');
    expect(rules.disallow).toContain('/account');
    expect(r.sitemap).toBe('https://example.com/sitemap.xml');
  });

  it('config fetch failure fails closed (Disallow /)', async () => {
    mockConfig.mockRejectedValue(new Error('backend down'));
    const r = await robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : (r.rules as any);
    expect(rules.disallow).toEqual(['/']);
    expect(r.sitemap).toBeUndefined();
  });
});
