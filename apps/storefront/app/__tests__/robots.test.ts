import { describe, it, expect } from 'vitest';
import robots from '@/app/robots';

process.env.NEXT_PUBLIC_BASE_URL = 'https://example.com';

describe('robots (4.4, F4)', () => {
  it('disallows private pages (no trailing slash — prefix covers the page itself) and references the sitemap', () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : (r.rules as any);
    for (const p of ['/account', '/admin', '/checkout', '/cart', '/orders', '/wishlist']) {
      expect(rules.disallow).toContain(p);
    }
    expect(r.sitemap).toBe('https://example.com/sitemap.xml');
  });

  it('uses NEXT_PUBLIC_STOREFRONT_URL for the sitemap line when set (F3)', () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://test.local';
    try {
      expect(robots().sitemap).toBe('https://test.local/sitemap.xml');
    } finally {
      delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
    }
  });
});
