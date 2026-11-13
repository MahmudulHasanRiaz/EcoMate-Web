import { describe, it, expect, vi, afterEach } from 'vitest';
import sitemap, { revalidate } from '@/app/sitemap';

/**
 * Mock fetch router: `routes` maps a URL substring to a JSON payload (or a
 * thrown error). Every mocked response carries `ok: true` unless the
 * payload is `{ __status: <code> }`, which simulates a non-2xx response.
 */
function mockFetch(routes: Record<string, any>, fallback: any = { data: [] }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input);
    for (const [key, value] of Object.entries(routes)) {
      if (url.includes(key)) {
        if (value instanceof Error) throw value;
        if (value && typeof value === 'object' && '__status' in value) {
          return { ok: false, status: value.__status, json: async () => ({}) } as any;
        }
        return { ok: true, status: 200, json: async () => value } as any;
      }
    }
    return { ok: true, status: 200, json: async () => fallback } as any;
  });
}

/** A storefront-config payload with the indexing flag set. */
const configOn = { searchIndexingEnabled: true };
const configOff = { searchIndexingEnabled: false };

describe('sitemap (P0-5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caches for an hour, follows cursor pagination, and emits clean category URLs + product images', async () => {
    expect(revalidate).toBe(3600);

    const fetchMock = mockFetch({
      '/system-settings/storefront': configOn,
      '/categories': { data: [{ slug: 'panjabi', updatedAt: '2026-10-01T00:00:00.000Z' }] },
      '/products?isActive=true&perPage=500&cursor=c1': {
        data: [{ slug: 'prod-b', updatedAt: '2026-10-02T00:00:00.000Z', images: ['/uploads/b.jpg'] }],
        meta: { hasMore: false, nextCursor: null },
      },
      '/products': {
        data: [{ slug: 'prod-a', updatedAt: '2026-10-01T00:00:00.000Z', images: ['/uploads/a.jpg'] }],
        meta: { hasMore: true, nextCursor: 'c1' },
      },
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
      mockFetch({ '/system-settings/storefront': configOn });
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
    mockFetch({ '/system-settings/storefront': configOn });
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => !e.url.includes('/products/'))).toBe(true);
  });

  it('never leaks the internal API origin into image URLs (production API_URL=http://backend:4000)', async () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://shop.example.com.bd';
    process.env.API_URL = 'http://backend:4000/api';
    try {
      mockFetch({
        '/system-settings/storefront': configOn,
        '/products': {
          data: [
            { slug: 'rel-img', updatedAt: '2026-10-01T00:00:00.000Z', images: ['/uploads/rel.jpg'] },
            { slug: 'abs-img', updatedAt: '2026-10-01T00:00:00.000Z', images: ['http://backend:4000/uploads/abs.jpg'] },
          ],
          meta: { hasMore: false, nextCursor: null },
        },
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

  it('flag OFF returns an empty sitemap', async () => {
    mockFetch({ '/system-settings/storefront': configOff });
    const entries = await sitemap();
    expect(entries).toEqual([]);
  });

  it('flag ON includes /company + /download only when their rows have real content, and omits content-less templates (D8)', async () => {
    const fetchMock = mockFetch({
      '/system-settings/storefront': configOn,
      '/cms-pages/slug/company': {
        id: 'c1', slug: 'company', isActive: true, updatedAt: '2026-11-01T00:00:00.000Z',
        config: { name: 'FixedPlus Ltd', registration: 'C-123' },
      },
      '/cms-pages/slug/download': {
        id: 'd1', slug: 'download', isActive: true, updatedAt: '2026-11-01T00:00:00.000Z',
        config: { androidUrl: 'https://play.example/app' },
      },
      '/cms-pages/slug/faq': {
        id: 'f1', slug: 'faq', isActive: true, updatedAt: '2026-11-01T00:00:00.000Z',
        config: { items: [] },
      },
      '/cms-pages/slug/about': {
        id: 'a1', slug: 'about', isActive: false, updatedAt: '2026-11-01T00:00:00.000Z',
        config: { story: 'Our story' },
      },
    });
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toContain('https://example.com/company');
    expect(urls).toContain('https://example.com/download');
    // Empty-neutral config → content-less → omitted even though active.
    expect(urls).not.toContain('https://example.com/faq');
    // Inactive row → omitted even though it has content.
    expect(urls).not.toContain('https://example.com/about');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/cms-pages/slug/company'))).toBe(true);
  });

  it('missing flag key (pre-toggle backend) keeps the historic ON behaviour', async () => {
    mockFetch({ '/system-settings/storefront': {} });
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.url === 'https://example.com')).toBe(true);
  });

  it('fetches CMS content pages from the public footer endpoint, never the role-guarded list', async () => {
    const fetchMock = mockFetch({
      '/system-settings/storefront': configOn,
      '/cms-pages/footer': [
        { id: 'p1', slug: 'track-order', title: 'Track Order', updatedAt: '2026-10-01T00:00:00.000Z' },
      ],
    });
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toContain('https://example.com/pages/track-order');
    const calls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(calls.some((u) => u.includes('/cms-pages/footer'))).toBe(true);
    // The old role-guarded list endpoint (exact path, no /slug/ or /footer).
    expect(
      calls.some((u) => /\/cms-pages\/?(\?|$)/.test(u)),
    ).toBe(false);
  });
});
