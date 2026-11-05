import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/api-server', () => ({
  serverFetch: vi.fn(),
}));

import { serverFetch } from '@/lib/api-server';
import { getBrandsServer, getTagsServer } from '@/lib/api/products-server';

const mocked = vi.mocked(serverFetch);

describe('PLP facet fetchers (brands / tags server lists)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocked.mockReset();
  });

  it('getBrandsServer hits the public brands route with the facet ISR options', async () => {
    mocked.mockResolvedValue([{ id: 'b1', name: 'Acme', slug: 'acme' }] as any);

    const res = await getBrandsServer();

    const [url, opts] = mocked.mock.calls[0];
    expect(String(url)).toBe('/brands?activeOnly=true');
    expect(opts).toMatchObject({ revalidate: 300, tags: ['products'] });
    expect(res).toEqual([{ id: 'b1', name: 'Acme', slug: 'acme' }]);
  });

  it('getTagsServer mirrors getBrandsServer against the tags facet route', async () => {
    mocked.mockResolvedValue([{ id: 't1', name: 'Sale', slug: 'sale' }] as any);

    const res = await getTagsServer();

    const [url, opts] = mocked.mock.calls[0];
    expect(String(url)).toBe('/tags/facets');
    expect(opts).toMatchObject({ revalidate: 300, tags: ['products'] });
    expect(res).toEqual([{ id: 't1', name: 'Sale', slug: 'sale' }]);
  });

  it('both unwrap a { data } envelope the same way', async () => {
    mocked.mockResolvedValue({ data: [{ id: 't2', name: 'New', slug: 'new' }] } as any);
    await expect(getTagsServer()).resolves.toEqual([{ id: 't2', name: 'New', slug: 'new' }]);

    mocked.mockResolvedValue({ data: [{ id: 'b2', name: 'Zenith', slug: 'zenith' }] } as any);
    await expect(getBrandsServer()).resolves.toEqual([{ id: 'b2', name: 'Zenith', slug: 'zenith' }]);
  });

  it('never throws: backend failure resolves to an empty list (archive falls back)', async () => {
    mocked.mockRejectedValue(new Error('down'));
    await expect(getTagsServer()).resolves.toEqual([]);
    await expect(getBrandsServer()).resolves.toEqual([]);
  });
});
