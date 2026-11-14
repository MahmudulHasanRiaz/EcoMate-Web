import { describe, it, expect, vi, beforeEach } from 'vitest';
import sitemap from '@/app/sitemap';
import { serverFetch } from '@/lib/api-server';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: 'demo.ecomate.bd' })),
}));
vi.mock('@/lib/api-server', () => ({ serverFetch: vi.fn() }));

const mockServerFetch = serverFetch as unknown as ReturnType<typeof vi.fn>;

const mockBackend = (overrides: { indexing?: boolean; footerPages?: any[] } = {}) => {
  mockServerFetch.mockImplementation(async (path: string) => {
    if (path === '/system-settings/storefront') {
      return { searchIndexingEnabled: overrides.indexing ?? true };
    }
    if (path.startsWith('/categories')) {
      return { data: [{ slug: 'cat-1', updatedAt: '2026-11-14T00:00:00.000Z' }] };
    }
    if (path.startsWith('/products')) {
      return {
        data: [{ slug: 'prod-1', images: [], updatedAt: '2026-11-14T00:00:00.000Z' }],
        meta: { hasMore: false },
      };
    }
    if (path.startsWith('/combos')) return { data: [] };
    if (path.startsWith('/cms-pages/slug/')) {
      const slug = path.replace('/cms-pages/slug/', '');
      // Only the FAQ row carries real configured content (D8); the rest
      // are content-less and stay out of the sitemap.
      const config = slug === 'faq' ? { items: [{ question: 'Q?', answer: 'A.' }] } : {};
      return { isActive: true, config, updatedAt: '2026-11-14T00:00:00.000Z' };
    }
    if (path === '/cms-pages/footer') {
      return overrides.footerPages ?? [
        { slug: 'privacy', type: 'content', updatedAt: '2026-11-14T00:00:00.000Z' },
        { slug: 'about', type: 'template', updatedAt: '2026-11-14T00:00:00.000Z' },
      ];
    }
    throw new Error(`unexpected sitemap fetch: ${path}`);
  });
};

const urls = (entries: { url: string }[]) => entries.map((e) => e.url);

describe('sitemap', () => {
  beforeEach(() => {
    mockServerFetch.mockReset();
    delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });

  it('homepage + /products present on the request-host domain (env unset)', async () => {
    mockBackend();
    const entries = await sitemap();
    const home = entries.find((e) => e.url === 'https://demo.ecomate.bd');
    expect(home).toBeDefined();
    expect(home!.priority).toBe(1);
    const products = entries.find((e) => e.url === 'https://demo.ecomate.bd/products');
    expect(products).toBeDefined();
    expect(products!.priority).toBe(0.9);
    expect(products!.changeFrequency).toBe('daily');
  });

  it('contains no /landing/ URL even with published landings present', async () => {
    // The sitemap never lists builder landings (rule a): no endpoint it
    // calls can produce one, so no entry may contain /landing/.
    mockBackend();
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const u of urls(entries)) expect(u).not.toContain('/landing/');
  });

  it('CMS rows use their real route: template → /<slug>, content → /pages/<slug>', async () => {
    mockBackend();
    const list = urls(await sitemap());
    expect(list).toContain('https://demo.ecomate.bd/about');
    expect(list).not.toContain('https://demo.ecomate.bd/pages/about');
    expect(list).toContain('https://demo.ecomate.bd/pages/privacy');
    expect(list).not.toContain('https://demo.ecomate.bd/privacy');
  });

  it('D8: content-less template pages stay out, content-bearing ones enter', async () => {
    mockBackend();
    const list = urls(await sitemap());
    expect(list).toContain('https://demo.ecomate.bd/faq');
    expect(list).not.toContain('https://demo.ecomate.bd/company');
    expect(list).not.toContain('https://demo.ecomate.bd/careers');
  });

  it('D7 flag OFF → empty sitemap', async () => {
    mockBackend({ indexing: false });
    await expect(sitemap()).resolves.toEqual([]);
  });

  it('backend failure is loud: every fetch failing throws instead of a degenerate sitemap', async () => {
    mockServerFetch.mockRejectedValue(new Error('API error: 500 Internal Server Error'));
    await expect(sitemap()).rejects.toThrow('sitemap: backend unreachable');
  });
});
