import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateMetadata } from '../page';

process.env.NEXT_PUBLIC_BASE_URL = 'https://example.com';

function mockBackend() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input);
    const body = (obj: any) =>
      ({ ok: true, text: async () => JSON.stringify(obj), json: async () => obj }) as any;
    if (url.includes('/system-settings/storefront')) return body({ store: { name: 'EcoMate' } });
    if (url.includes('/license/status')) return body({ active: true, features: [], message: '' });
    if (url.includes('/categories')) return body([{ id: 'c1', name: 'Panjabi', slug: 'panjabi' }]);
    if (url.includes('/brands')) return body([{ id: 'b1', name: 'Aarong', slug: 'aarong' }]);
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe('archive generateMetadata (P3-2/P3-3 + 4.1/4.2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockBackend();
  });

  it('bare /products gets a title + self-canonical', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(meta.title).toBe('Products');
    expect(meta.alternates?.canonical).toBe('https://example.com/products');
  });

  it('single category facet resolves the name and canonicalizes to the clean URL', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ category: 'panjabi' }) });
    expect(meta.title).toBe('Panjabi');
    expect(meta.description).toContain('EcoMate');
    expect(meta.alternates?.canonical).toBe('https://example.com/category/panjabi');
  });

  it('single tag facet canonicalizes to the tag URL', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ tag: 'wedding' }) });
    expect(meta.alternates?.canonical).toBe('https://example.com/products/tags/wedding');
  });

  it('single brand facet resolves the name and canonicalizes to the brand URL', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ brand: 'aarong' }) });
    expect(meta.title).toBe('Aarong');
    expect(meta.alternates?.canonical).toBe('https://example.com/brand/aarong');
  });

  it('multi-facet and sorted views are noindex,follow with no canonical', async () => {
    const multi = await generateMetadata({
      searchParams: Promise.resolve({ category: 'panjabi', brand: 'aarong' }),
    });
    expect(multi.robots).toEqual({ index: false, follow: true });
    expect(multi.alternates).toBeUndefined();

    const sorted = await generateMetadata({
      searchParams: Promise.resolve({ category: 'panjabi', sort: 'price-low' }),
    });
    expect(sorted.robots).toEqual({ index: false, follow: true });
  });

  it('single search facet is self-canonical', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ search: 'cotton' }) });
    expect(String(meta.alternates?.canonical)).toContain('search=cotton');
  });

  it('prefers NEXT_PUBLIC_STOREFRONT_URL over NEXT_PUBLIC_BASE_URL (F3)', async () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://test.local';
    try {
      const meta = await generateMetadata({ searchParams: Promise.resolve({ category: 'panjabi' }) });
      expect(meta.alternates?.canonical).toBe('https://test.local/category/panjabi');
    } finally {
      delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
    }
  });
});
