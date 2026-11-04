import { describe, it, expect, vi, afterEach } from 'vitest';
import sitemap, { revalidate } from '@/app/sitemap';

describe('sitemap (P0-5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caches for an hour, follows cursor pagination, and emits clean category URLs + product images', async () => {
    expect(revalidate).toBe(3600);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      const json = async () => {
        if (url.includes('/categories')) {
          return { data: [{ slug: 'panjabi', updatedAt: '2026-10-01T00:00:00.000Z' }] };
        }
        if (url.includes('/products')) {
          if (url.includes('cursor=c1')) {
            return {
              data: [{ slug: 'prod-b', updatedAt: '2026-10-02T00:00:00.000Z', images: ['/uploads/b.jpg'] }],
              meta: { hasMore: false, nextCursor: null },
            };
          }
          return {
            data: [{ slug: 'prod-a', updatedAt: '2026-10-01T00:00:00.000Z', images: ['/uploads/a.jpg'] }],
            meta: { hasMore: true, nextCursor: 'c1' },
          };
        }
        return { data: [] };
      };
      return { json } as any;
    });

    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    // cursor pagination followed — both pages present
    expect(urls).toContain('https://example.com/products/prod-a');
    expect(urls).toContain('https://example.com/products/prod-b');
    const productCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/products'));
    expect(productCalls.length).toBe(2);

    // clean category URL (canonical form), not /products?category=
    expect(urls).toContain('https://example.com/category/panjabi');
    expect(urls.some((u) => u.includes('/products?category='))).toBe(false);

    // image sitemap entries with absolute URLs
    const prodA = entries.find((e) => e.url === 'https://example.com/products/prod-a');
    expect((prodA as any)?.images?.[0]).toMatch(/^https?:\/\/.+\/uploads\/a\.jpg$/);
  });

  it('builds every URL from NEXT_PUBLIC_STOREFRONT_URL when set (F3)', async () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://test.local';
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ json: async () => ({ data: [] }) }) as any);
      const urls = (await sitemap()).map((e) => e.url);
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) {
        expect(u === 'https://test.local' || u.startsWith('https://test.local/')).toBe(true);
      }
    } finally {
      delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
    }
  });

  it('throws instead of caching a degenerate sitemap when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    await expect(sitemap()).rejects.toThrow('backend unreachable');
  });

  it('does not throw during the build-time prerender (no backend exists in the builder)', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        throw new Error('connect ECONNREFUSED');
      });
      const entries = await sitemap();
      expect(entries.length).toBeGreaterThan(0);
    } finally {
      delete process.env.NEXT_PHASE;
    }
  });

  it('serves a static-only sitemap when the backend answers with empty catalogs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ json: async () => ({ data: [] }) }) as any);
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => !e.url.includes('/products/'))).toBe(true);
  });

  it('never leaks the internal API origin into image URLs (production API_URL=http://backend:4000)', async () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://shop.example.com.bd';
    process.env.API_URL = 'http://backend:4000/api';
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
        const url = String(input);
        const json = async () => {
          if (url.includes('/products')) {
            return {
              data: [
                { slug: 'rel-img', updatedAt: '2026-10-01T00:00:00.000Z', images: ['/uploads/rel.jpg'] },
                { slug: 'abs-img', updatedAt: '2026-10-01T00:00:00.000Z', images: ['http://backend:4000/uploads/abs.jpg'] },
              ],
              meta: { hasMore: false, nextCursor: null },
            };
          }
          return { data: [] };
        };
        return { json } as any;
      });
      const entries = await sitemap();
      const rel = entries.find((e) => e.url.endsWith('/products/rel-img')) as any;
      const abs = entries.find((e) => e.url.endsWith('/products/abs-img')) as any;
      expect(rel?.images?.[0]).toBe('https://shop.example.com.bd/uploads/rel.jpg');
      expect(abs?.images?.[0]).toBe('https://shop.example.com.bd/uploads/abs.jpg');
      for (const e of entries) {
        for (const img of (e as any).images ?? []) {
          expect(img).not.toContain('backend');
        }
      }
    } finally {
      delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
      delete process.env.API_URL;
    }
  });
});
