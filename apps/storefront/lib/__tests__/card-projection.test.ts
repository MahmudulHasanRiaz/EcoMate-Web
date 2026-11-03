import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from '@/lib/api-client';
import {
  transformBackendProduct,
  transformBackendProductCard,
  toCardProduct,
  getProductCards,
} from '../api/products';

vi.mock('@/lib/api-client', () => ({
  default: { get: vi.fn() },
}));

const deriv = (name: string) => ({
  derivativeManifest: {
    thumb: `/uploads/derivatives/${name}/thumb.webp`,
    small: `/uploads/derivatives/${name}/small.webp`,
    medium: `/uploads/derivatives/${name}/medium.webp`,
    large: `/uploads/derivatives/${name}/large.webp`,
    xlarge: `/uploads/derivatives/${name}/xlarge.webp`,
    original: `/uploads/derivatives/${name}/original.webp`,
  },
  blurUrl: `/uploads/derivatives/${name}/blur.webp`,
});

/** Representative heavy list row, mirroring the backend list include. */
function rawFixture() {
  const images = [1, 2, 3, 4].map((i) => `/uploads/img-${i}.jpg`);
  const meta: any = {};
  for (const u of images) meta[u] = deriv(u.split('/').pop()!.replace('.jpg', ''));
  const variants = [0, 1, 2].map((i) => ({
    id: `v${i}`,
    sku: `SKU-V${i}`,
    price: 1500 + i * 100,
    salePrice: 1200 + i * 100,
    managedStockQuantity: 5,
    availableStock: i === 0 ? 0 : 5,
    image: images[i],
    images: [images[i]],
    isActive: true,
    attributeValues: [
      { attributeValue: { id: `av${i}`, value: ['S', 'M', 'L'][i], attribute: { id: 'a1', name: 'Size' } } },
    ],
  }));
  return {
    id: 'p1',
    name: 'Representative Product With A Longish Name',
    slug: 'rep-product',
    basePrice: 2000,
    salePrice: 1590,
    originalPrice: 2000,
    type: 'variable',
    images,
    image: images[0],
    category: { id: 'c1', name: 'Panjabi', slug: 'panjabi' },
    categoryId: 'c1',
    brand: { id: 'b1', name: 'Brand', slug: 'brand', logo: '/uploads/logo.png' },
    isFeatured: true,
    description: `<p>${'Long product description HTML. '.repeat(40)}</p>`,
    shortDesc: 'Short description '.repeat(10),
    descriptionSections: { tagline: 'Tagline', benefits: ['b1'], specifications: 'Specs '.repeat(20) },
    availableStock: 15,
    sku: 'SKU-1',
    manageStock: true,
    availabilityMode: 'MANAGED_STOCK',
    tags: ['cotton', 'eid'],
    isActive: true,
    variants,
    codAvailable: true,
    videoUrl: 'https://youtube.com/watch?v=x',
    detailRows: [{ label: 'Fabric', value: 'Cotton' }],
    customizations: [{ id: 'g1', name: 'Gift wrap', options: [{ id: 'o1', label: 'Wrap', priceDelta: 50 }] }],
    averageRating: 4.5,
    _count: { reviews: 12 },
    _mediaMeta: meta,
  };
}

describe('P2 card projection', () => {
  it('drops every heavy field the card never renders', () => {
    const card = transformBackendProductCard(rawFixture());
    const keys = Object.keys(card);
    for (const heavy of [
      'description', 'shortDesc', 'descriptionSections', 'customizations',
      'detailRows', 'videoUrl', 'images', 'variants', 'reviews',
      'basePrice', 'salePrice', 'codAvailable', 'manageStock', 'isActive',
    ]) {
      expect(keys, `card must not carry ${heavy}`).not.toContain(heavy);
    }
    expect(JSON.stringify(card)).not.toContain('Long product description');
  });

  it('keeps every field the card DOES render, with values identical to the full transform', () => {
    const raw = rawFixture();
    const full = transformBackendProduct(raw);
    const card = toCardProduct(full);
    expect(card.id).toBe(full.id);
    expect(card.name).toBe(full.name);
    expect(card.slug).toBe(full.slug);
    expect(card.price).toBe(full.price);
    expect(card.originalPrice).toBe(full.originalPrice);
    expect(card.priceRange).toEqual(full.priceRange);
    expect(card.image).toBe(full.image);
    expect(card.category).toBe(full.category);
    expect(card.categorySlug).toBe(full.categorySlug);
    expect(card.brand).toEqual(full.brand);
    expect(card.badge).toBe(full.badge);
    expect(card.saveAmount).toBe(full.saveAmount);
    expect(card.stock).toBe(full.stock);
    expect(card.sku).toBe(full.sku);
    expect(card.tags).toEqual(full.tags);
    expect(card.availabilityMode).toBe(full.availabilityMode);
    expect(card.averageRating).toBe(full.averageRating);
    expect(card.reviewCount).toBe(full.reviewCount);
  });

  it('summarizes variants instead of shipping the tree', () => {
    const card = transformBackendProductCard(rawFixture());
    expect(card.hasVariants).toBe(true);
    expect(card.variantCount).toBe(3);
    // v0 is out of stock, v1/v2 in stock → same predicate the full
    // variant tree gave ProductCard's OOS check.
    expect(card.anyVariantInStock).toBe(true);
    const simple = transformBackendProductCard({ ...rawFixture(), type: 'simple', variants: [] });
    expect(simple.hasVariants).toBe(false);
    expect(simple.variantCount).toBe(0);
    expect(simple.anyVariantInStock).toBe(false);
  });

  it('narrows mediaMeta to the primary image’s small derivative only', () => {
    const card = transformBackendProductCard(rawFixture());
    expect(Object.keys(card.mediaMeta || {})).toEqual(['/uploads/img-1.jpg']);
    expect(card.mediaMeta?.['/uploads/img-1.jpg'].derivativeManifest).toEqual({
      small: '/uploads/derivatives/img-1/small.webp',
    });
  });

  it('payload measurement: bytes + derivative URLs collapse vs the full transform', () => {
    const raw = rawFixture();
    const oldJson = JSON.stringify(transformBackendProduct(raw));
    const newJson = JSON.stringify(transformBackendProductCard(raw));
    const count = (s: string) => (s.match(/\/derivatives\//g) || []).length;
    // Baseline measured 2026-11-03 on this fixture: 4,909 bytes, 28 URLs.
    console.log(
      `CARD_MEASURE old=${oldJson.length}B/${count(oldJson)}urls new=${newJson.length}B/${count(newJson)}urls`,
    );
    expect(count(newJson)).toBe(1);
    expect(newJson.length).toBeLessThan(oldJson.length * 0.35);
  });
});

describe('getProductCards', () => {
  beforeEach(() => vi.mocked(apiClient.get).mockReset());

  it('requests the backend opt-in fields=card and projects the rows', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { data: [rawFixture()], meta: { total: 1, page: 1, perPage: 24, totalPages: 1, nextCursor: null, hasMore: false } },
    } as any);
    const res = await getProductCards({ isActive: true, perPage: 24 });
    const [url, config] = vi.mocked(apiClient.get).mock.calls[0];
    expect(url).toBe('/products');
    expect(config!.params).toMatchObject({ isActive: true, perPage: 24, fields: 'card' });
    expect(res.data[0]).not.toHaveProperty('description');
    expect(res.data[0].hasVariants).toBe(true);
    expect(res.meta.total).toBe(1);
  });
});
