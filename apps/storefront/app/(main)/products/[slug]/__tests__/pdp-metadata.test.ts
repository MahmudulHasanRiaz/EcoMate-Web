import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateMetadata } from '../page';
import { getBackendStatusServer, getProductBySlugServer } from '@/lib/api/products-server';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';

vi.mock('@/lib/api/products-server', () => ({
  getProductBySlugServer: vi.fn(),
  getRelatedProductsServer: vi.fn(),
  getReviewsServer: vi.fn(),
  getTopProductSlugsServer: vi.fn(),
  getBackendStatusServer: vi.fn(),
}));
vi.mock('@/lib/api/storefront-config-server', () => ({
  getStorefrontConfigServer: vi.fn(),
}));

const mockProduct = vi.mocked(getProductBySlugServer);
const mockStatus = vi.mocked(getBackendStatusServer);
const mockConfig = vi.mocked(getStorefrontConfigServer);

const baseProduct = {
  id: 'p1',
  name: 'Test Panjabi',
  slug: 'test-panjabi',
  price: 1000,
  image: '/uploads/p1.jpg',
  images: ['/uploads/p1.jpg'],
  type: 'simple',
  stock: 5,
  category: 'Panjabi',
  categorySlug: 'panjabi',
  sku: 'TP-1',
  brand: { id: 'b1', name: 'TestBrand', slug: 'testbrand' },
  shortDesc: '',
  description: '<p>Fine cotton.</p>',
  reviewCount: 0,
} as any;

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe('PDP generateMetadata (F2/F3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });

  it('emits absolute-public canonical + OG, rewriting the internal backend origin', async () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://test.local';
    mockConfig.mockResolvedValue({ store: { name: 'EcoMate' } } as any);
    mockProduct.mockResolvedValue({ ...baseProduct, image: 'http://backend:4000/uploads/p1.jpg' });

    const meta: any = await generateMetadata(params('test-panjabi'));

    expect(meta.alternates?.canonical).toBe('https://test.local/products/test-panjabi');
    expect(meta.openGraph?.images?.[0]?.url).toBe('https://test.local/uploads/p1.jpg');
    expect(meta.openGraph?.url).toBe('https://test.local/products/test-panjabi');
    expect(meta.title).toBe('Test Panjabi');
  });

  it('absolutizes relative images and leaves CDN images untouched', async () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://test.local';
    mockConfig.mockResolvedValue({ store: { name: 'EcoMate' } } as any);

    mockProduct.mockResolvedValue({ ...baseProduct, image: '/uploads/p1.jpg' });
    const rel: any = await generateMetadata(params('test-panjabi'));
    expect(rel.openGraph?.images?.[0]?.url).toBe('https://test.local/uploads/p1.jpg');

    mockProduct.mockResolvedValue({ ...baseProduct, image: 'https://cdn.example.com/p1.jpg' });
    const cdn: any = await generateMetadata(params('test-panjabi'));
    expect(cdn.openGraph?.images?.[0]?.url).toBe('https://cdn.example.com/p1.jpg');
  });

  it('never crashes with env unset (relative output, no internal leak)', async () => {
    mockConfig.mockRejectedValue(new Error('down'));
    mockProduct.mockResolvedValue({ ...baseProduct, image: '/uploads/p1.jpg' });

    const meta: any = await generateMetadata(params('test-panjabi'));

    expect(meta.alternates?.canonical).toBe('/products/test-panjabi');
    expect(meta.openGraph?.images?.[0]?.url).toBe('/uploads/p1.jpg');
  });

  it('distinguishes true 404 from backend outage', async () => {
    mockConfig.mockResolvedValue({ store: { name: 'EcoMate' } } as any);
    mockProduct.mockResolvedValue(null);

    mockStatus.mockResolvedValue(true);
    expect(((await generateMetadata(params('ghost'))) as any).title).toBe('Product Not Found');

    mockStatus.mockResolvedValue(false);
    const outage: any = await generateMetadata(params('ghost'));
    expect(outage.title).toBe('Service Unavailable');
    expect(outage.robots).toEqual({ index: false, follow: false });
  });
});
