import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/api-server', () => ({
  serverFetch: vi.fn(),
}));

import { serverFetch } from '@/lib/api-server';
import { fetchProductCardsServer } from '@/lib/api/products-server';

const mocked = vi.mocked(serverFetch);

describe('fetchProductCardsServer (P2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocked.mockReset();
  });

  it('requests fields=card, keeps the ISR fetch options intact, returns slim cards', async () => {
    mocked.mockResolvedValue({
      data: [
        {
          id: 'p1', name: 'P1', slug: 'x', basePrice: 100, type: 'simple',
          images: ['/a.jpg'], description: '<p>heavy</p>', variants: [],
          _mediaMeta: { '/a.jpg': { derivativeManifest: { small: '/s.webp', large: '/l.webp' }, blurUrl: '/b.webp' } },
        },
      ],
      meta: { total: 1, perPage: 24, nextCursor: null, hasMore: false },
    } as any);

    const res = await fetchProductCardsServer({ isActive: true, perPage: 24 });

    const [url, opts] = mocked.mock.calls[0];
    expect(String(url)).toContain('/products?');
    expect(String(url)).toContain('fields=card');
    expect(String(url)).toContain('isActive=true');
    // The 60s data-cache options must survive untouched so sibling
    // caching/tag work composes at merge.
    expect(opts).toMatchObject({ revalidate: 60, maxRetries: 1, timeout: 5000 });

    expect(res.data).toHaveLength(1);
    expect(res.data[0]).not.toHaveProperty('description');
    expect(res.data[0]).not.toHaveProperty('variants');
    expect(JSON.stringify(res.data[0])).not.toContain('/l.webp');
    expect(res.data[0].image).toBe('/a.jpg');
  });

  it('never throws: backend failure resolves to an empty list', async () => {
    mocked.mockRejectedValue(new Error('down'));
    await expect(fetchProductCardsServer({ perPage: 4 })).resolves.toMatchObject({ data: [] });
  });
});
