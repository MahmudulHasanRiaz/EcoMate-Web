import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/api-server', () => ({
  serverFetch: vi.fn(),
}));

import { serverFetch } from '@/lib/api-server';
import {
  getProductBySlugServer,
  getRelatedProductsServer,
  getReviewsServer,
  getTopProductSlugsServer,
} from '@/lib/api/products-server';

const mocked = vi.mocked(serverFetch);

describe('products-server request memoization (P0-2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocked.mockReset();
  });

  // NOTE: React cache() request-memoization only dedupes inside a live
  // Next.js request scope (generateMetadata + page share one scope in
  // production — same pattern as getStorefrontConfigServer). vitest's React
  // build provides no request scope (proven: even a trivial cache() fn runs
  // twice there), so per-request single-hit is verified via the staging
  // backend access log (Phase 1 acceptance), not here. This test locks the
  // refactor for regressions: same fetcher, same results for both callers.
  it('serves identical product data to concurrent same-slug callers (generateMetadata + page)', async () => {
    mocked.mockResolvedValue({ id: 'p1', name: 'P1', slug: 'x', basePrice: 100 } as any);

    const [a, b] = await Promise.all([getProductBySlugServer('x'), getProductBySlugServer('x')]);

    expect(a).toEqual(b);
    expect(a?.id).toBe('p1');
    expect(mocked.mock.calls[0][0]).toBe(mocked.mock.calls[1][0]);
  });

  it('passes surge-safe fetch options on the hot product-detail path', async () => {
    mocked.mockResolvedValue({ id: 'p1', name: 'P1', slug: 'y', basePrice: 100 } as any);

    await getProductBySlugServer('y');

    // revalidate MUST stay >0: the PDP is statically prerendered and a
    // `revalidate: 0` fetch flips it to dynamic at runtime (production 500).
    expect(mocked).toHaveBeenCalledWith(
      expect.stringContaining('/products/slug/y'),
      expect.objectContaining({ revalidate: 60, maxRetries: 1, timeout: 5000 }),
    );
  });

  it('getRelatedProductsServer mirrors the client logic on the server (excludes self, tag-first, max 8)', async () => {
    // license/status uses raw global fetch inside getStorefrontConfigServer — stub it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      json: async () => ({ active: true, features: [], message: '' }),
    }) as any);
    mocked.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/products?') || String(url) === '/products') {
        return {
          data: [
            { id: 'self-1', name: 'Self', slug: 'self', basePrice: 10, tags: ['cotton'] },
            ...Array.from({ length: 10 }, (_, i) => ({
              id: `rel-${i}`,
              name: `Rel ${i}`,
              slug: `rel-${i}`,
              basePrice: 10 + i,
              tags: i < 2 ? ['cotton'] : ['other'],
            })),
          ],
          meta: { total: 11, perPage: 20, nextCursor: null, hasMore: false },
        } as any;
      }
      return { id: 'cfg', store: { name: 'Store' } } as any;
    });

    const items = await getRelatedProductsServer({
      id: 'self-1',
      slug: 'self',
      tags: ['cotton'],
      categorySlug: 'panjabi',
    } as any);

    expect(items.length).toBeLessThanOrEqual(8);
    expect(items.some((p) => p.id === 'self-1')).toBe(false);
    // tag-matched items come before untagged ones
    const firstUntagged = items.findIndex((p) => !(p.tags || []).includes('cotton'));
    const taggedAfter = items.slice(firstUntagged + 1).filter((p) => (p.tags || []).includes('cotton'));
    expect(taggedAfter).toEqual([]);
  });

  it('getReviewsServer unwraps the {data, meta} envelope and never throws', async () => {
    mocked.mockResolvedValueOnce({
      data: [{ id: 'r1', productId: 'p1', customerName: 'A', rating: 5, text: 'Nice', createdAt: '2026-01-01' }],
      meta: { total: 1 },
    } as any);
    await expect(getReviewsServer('slug-a')).resolves.toEqual([
      { id: 'r1', productId: 'p1', customerName: 'A', rating: 5, text: 'Nice', createdAt: '2026-01-01' },
    ]);

    mocked.mockResolvedValueOnce([] as any);
    await expect(getReviewsServer('slug-b')).resolves.toEqual([]);

    mocked.mockRejectedValueOnce(new Error('down'));
    await expect(getReviewsServer('slug-c')).resolves.toEqual([]);
  });

  it('getTopProductSlugsServer returns slugs, [] on backend failure (build-safe)', async () => {
    mocked.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/products?')) {
        return {
          data: [
            { id: 'p1', name: 'A', slug: 'prod-a', basePrice: 10 },
            { id: 'p2', name: 'B', slug: 'prod-b', basePrice: 20 },
          ],
          meta: { total: 2, perPage: 200, nextCursor: null, hasMore: false },
        } as any;
      }
      throw new Error(`unexpected: ${url}`);
    });
    await expect(getTopProductSlugsServer(200)).resolves.toEqual(['prod-a', 'prod-b']);

    mocked.mockRejectedValue(new Error('backend down'));
    await expect(getTopProductSlugsServer(50)).resolves.toEqual([]);
  });

  it('getBackendStatusServer reflects reachability with a single short probe', async () => {
    // Module-level React cache() persists per evaluation — load a fresh copy
    // per case so each assertion exercises a real probe.
    const freshStatus = async () => {
      vi.resetModules();
      const api = await import('@/lib/api-server');
      const ps = await import('@/lib/api/products-server');
      return { fetch: vi.mocked(api.serverFetch), status: ps.getBackendStatusServer };
    };

    const up = await freshStatus();
    up.fetch.mockResolvedValueOnce({ store: { name: 'S' } } as any);
    await expect(up.status()).resolves.toBe(true);
    expect(up.fetch).toHaveBeenCalledWith(
      '/system-settings/storefront',
      expect.objectContaining({ maxRetries: 0, timeout: 3000 }),
    );

    const down = await freshStatus();
    down.fetch.mockRejectedValueOnce(new Error('down'));
    const callsBefore = down.fetch.mock.calls.length;
    await expect(down.status()).resolves.toBe(false);
    // single attempt, no retry storm on the error path
    expect(down.fetch.mock.calls.length).toBe(callsBefore + 1);
  });
});
