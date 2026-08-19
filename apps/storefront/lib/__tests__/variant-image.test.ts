import { describe, expect, it } from 'vitest';
import { resolveVariantImage, parentImage } from '../variant-image';

const product = {
  image: '/uploads/parent.jpg',
  images: ['/uploads/parent.jpg', '/uploads/parent-2.jpg'],
};

const av = (name: string, value: string, image?: string) => ({
  attributeValue: { attribute: { name }, value, image },
});

describe('resolveVariantImage', () => {
  it('prefers the variant own image', () => {
    const variant: any = { image: '/uploads/v.jpg', images: [], attributeValues: [av('Size', 'S')] };
    expect(resolveVariantImage(variant, product)).toBe('/uploads/v.jpg');
  });

  it('prefers the first variant images[] entry over the single image', () => {
    const variant: any = { image: '/uploads/v.jpg', images: ['/uploads/v2.jpg'], attributeValues: [] };
    expect(resolveVariantImage(variant, product)).toBe('/uploads/v2.jpg');
  });

  it('falls back to the COLOR attribute image when the variant has no own image', () => {
    const variant: any = {
      image: null,
      images: [],
      attributeValues: [
        av('Size', 'L', '/uploads/size-l.jpg'),
        av('Color', 'Red', '/uploads/red.jpg'),
      ],
    };
    expect(resolveVariantImage(variant, product)).toBe('/uploads/red.jpg');
  });

  it('uses the only attribute image when there is no color attribute', () => {
    const variant: any = { image: null, images: [], attributeValues: [av('Size', 'L', '/uploads/size-l.jpg')] };
    expect(resolveVariantImage(variant, product)).toBe('/uploads/size-l.jpg');
  });

  it('falls back to the parent product image when no attribute has an image', () => {
    const variant: any = {
      image: null,
      images: [],
      attributeValues: [av('Size', 'L'), av('Color', 'Red')],
    };
    expect(resolveVariantImage(variant, product)).toBe('/uploads/parent.jpg');
  });

  it('falls back to the parent when the variant has no image data at all', () => {
    const variant: any = { image: null, images: [], attributeValues: [] };
    expect(resolveVariantImage(variant, product)).toBe('/uploads/parent.jpg');
  });

  it('returns the parent for a null variant', () => {
    expect(resolveVariantImage(null, product)).toBe('/uploads/parent.jpg');
    expect(resolveVariantImage(undefined, product)).toBe('/uploads/parent.jpg');
  });

  it('returns undefined when neither variant nor product has images', () => {
    const emptyProduct: any = { image: null, images: [] };
    const variant: any = { image: null, images: [], attributeValues: [] };
    expect(resolveVariantImage(variant, emptyProduct)).toBeUndefined();
  });

  it('treats an empty-string variant image as missing (falls through the cascade)', () => {
    const variant: any = {
      image: '',
      images: [],
      attributeValues: [av('Color', 'Red', '/uploads/red.jpg')],
    };
    expect(resolveVariantImage(variant, product)).toBe('/uploads/red.jpg');
  });
});

describe('parentImage', () => {
  it('returns the single image', () => {
    expect(parentImage({ image: '/uploads/a.jpg', images: [] })).toBe('/uploads/a.jpg');
  });

  it('returns the first images[] entry when image is missing', () => {
    expect(parentImage({ image: null, images: ['/uploads/b.jpg'] } as any)).toBe('/uploads/b.jpg');
  });

  it('returns undefined when empty', () => {
    expect(parentImage({ image: null, images: [] } as any)).toBeUndefined();
  });
});
