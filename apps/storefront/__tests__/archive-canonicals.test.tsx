import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateMetadata as brandMetadata } from '@/app/(main)/brand/[slug]/page';
import { generateMetadata as categoryMetadata } from '@/app/(main)/category/[slug]/page';
import { generateMetadata as tagMetadata } from '@/app/(main)/products/tags/[slug]/page';
import { generateMetadata as archiveMetadata } from '@/app/(main)/products/page';
import { generateMetadata as pdpMetadata } from '@/app/(main)/products/[slug]/page';
import { generateMetadata as combosMetadata } from '@/app/(main)/combos/page';
import { generateMetadata as colorsMetadata } from '@/app/(main)/products/[slug]/colors/page';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';
import {
  getBrandsServer,
  getCategoriesServer,
  getProductBySlugServer,
} from '@/lib/api/products-server';

// Controlled request headers: the request-derived tier of the chain.
let mockHeadersValue: Headers | null = new Headers({ host: 'demo.ecomate.bd' });

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    if (mockHeadersValue === null) throw new Error('headers() called outside a request scope');
    return mockHeadersValue;
  }),
}));

// Controlled storefront config: canonicalDomain present → Settings tier.
let mockConfigValue: any = { store: { name: 'Test Store' } };

vi.mock('@/lib/api/storefront-config-server', () => ({
  getStorefrontConfigServer: vi.fn(async () => mockConfigValue),
}));

// Server data fetches behind the metadata functions.
vi.mock('@/lib/api/products-server', () => ({
  getBackendStatusServer: vi.fn(async () => true),
  getProductBySlugServer: vi.fn(),
  getRelatedProductsServer: vi.fn(async () => []),
  getReviewsServer: vi.fn(async () => []),
  getSizeChartPresenceServer: vi.fn(async () => false),
  getTopProductSlugsServer: vi.fn(async () => []),
  getBrandsServer: vi.fn(),
  getCategoriesServer: vi.fn(),
  getTagsServer: vi.fn(async () => []),
  fetchProductCardsServer: vi.fn(async () => []),
}));

vi.mock('@/lib/api/combos-server', () => ({
  fetchCombosServer: vi.fn(async () => []),
}));

const mockGetConfig = getStorefrontConfigServer as unknown as ReturnType<
  typeof vi.fn
>;
const mockGetBrands = getBrandsServer as unknown as ReturnType<typeof vi.fn>;
const mockGetCategories = getCategoriesServer as unknown as ReturnType<
  typeof vi.fn
>;
const mockGetProduct = getProductBySlugServer as unknown as ReturnType<
  typeof vi.fn
>;

const ENV_KEYS = [
  'STORE_NEXT_PUBLIC_STOREFRONT_URL',
  'NEXT_PUBLIC_STOREFRONT_URL',
  'NEXT_PUBLIC_BASE_URL',
] as const;
let savedEnv: Record<string, string | undefined>;

const product = {
  slug: 'test-hoodie',
  name: 'Test Hoodie',
  description: 'A test hoodie',
  shortDesc: 'Test hoodie',
  price: 100,
  stock: 5,
  category: 'Hoodies',
  categorySlug: 'hoodies',
};

describe('archive / PDP / combo / color canonicals use the request-derived origin', () => {
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    mockHeadersValue = new Headers({ host: 'demo.ecomate.bd' });
    mockConfigValue = { store: { name: 'Test Store' } };
    mockGetConfig.mockClear();
    mockGetBrands.mockResolvedValue([{ slug: 'acme', name: 'Acme' }]);
    mockGetCategories.mockResolvedValue([{ slug: 'shoes', name: 'Shoes' }]);
    mockGetProduct.mockResolvedValue(product);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  const params = (slug: string) => Promise.resolve({ slug });

  it('brand / category / tag / archive canonicals use the request host', async () => {
    const brand = await brandMetadata({
      params: params('acme'),
      searchParams: Promise.resolve({}),
    } as any);
    expect((brand.alternates as any).canonical).toBe(
      'https://demo.ecomate.bd/brand/acme',
    );

    const category = await categoryMetadata({
      params: params('shoes'),
      searchParams: Promise.resolve({}),
    } as any);
    expect((category.alternates as any).canonical).toBe(
      'https://demo.ecomate.bd/category/shoes',
    );

    const tag = await tagMetadata({
      params: params('winter'),
      searchParams: Promise.resolve({}),
    } as any);
    expect((tag.alternates as any).canonical).toBe(
      'https://demo.ecomate.bd/products/tags/winter',
    );

    const archive = await archiveMetadata({
      searchParams: Promise.resolve({}),
    });
    expect((archive.alternates as any).canonical).toBe(
      'https://demo.ecomate.bd/products',
    );
  });

  it('PDP canonical + OG url use the request host', async () => {
    const meta = await pdpMetadata({ params: params('test-hoodie') });
    expect((meta.alternates as any).canonical).toBe(
      'https://demo.ecomate.bd/products/test-hoodie',
    );
    expect((meta.openGraph as any).url).toBe(
      'https://demo.ecomate.bd/products/test-hoodie',
    );
  });

  it('combos + colors canonicals use the request host', async () => {
    const combos = await combosMetadata();
    expect((combos.alternates as any).canonical).toBe(
      'https://demo.ecomate.bd/combos',
    );

    const colors = await colorsMetadata({
      params: params('test-hoodie'),
      searchParams: Promise.resolve({}),
    });
    expect((colors.alternates as any).canonical).toBe(
      'https://demo.ecomate.bd/products/test-hoodie',
    );
  });

  it('a saved Settings domain wins over the request host on every surface', async () => {
    mockConfigValue = {
      store: { name: 'Test Store' },
      canonicalDomain: 'https://shop.example.com',
    };
    mockHeadersValue = new Headers({
      'x-forwarded-host': 'evil.example.net',
      host: 'demo.ecomate.bd',
    });

    const brand = await brandMetadata({
      params: params('acme'),
      searchParams: Promise.resolve({}),
    } as any);
    expect((brand.alternates as any).canonical).toBe(
      'https://shop.example.com/brand/acme',
    );

    const archive = await archiveMetadata({
      searchParams: Promise.resolve({}),
    });
    expect((archive.alternates as any).canonical).toBe(
      'https://shop.example.com/products',
    );

    const pdp = await pdpMetadata({ params: params('test-hoodie') });
    expect((pdp.alternates as any).canonical).toBe(
      'https://shop.example.com/products/test-hoodie',
    );

    const combos = await combosMetadata();
    expect((combos.alternates as any).canonical).toBe(
      'https://shop.example.com/combos',
    );
  });

  it('a spoofed x-forwarded-host becomes the canonical only while no Settings domain is set', async () => {
    mockHeadersValue = new Headers({
      'x-forwarded-host': 'shop.example.com',
      host: 'demo.ecomate.bd',
    });
    const archive = await archiveMetadata({
      searchParams: Promise.resolve({}),
    });
    expect((archive.alternates as any).canonical).toBe(
      'https://shop.example.com/products',
    );
  });
});
