import {
  extractUploadImagePaths,
  rewriteUploadImages,
} from '../html-image-rewrite';
import type { DerivativeMap } from '../media-resolver.service';

const MAP: DerivativeMap = {
  '/uploads/banner.jpg': {
    derivativeManifest: {
      small: '/uploads/derivatives/m1/small.webp',
      medium: '/uploads/derivatives/m1/medium.webp',
      large: '/uploads/derivatives/m1/large.webp',
      large_avif: '/uploads/derivatives/m1/large.avif',
    },
    blurUrl: null,
    updatedAt: new Date(),
  },
  '/uploads/legacy.png': {
    derivativeManifest: null,
    blurUrl: null,
    updatedAt: new Date(),
  },
};

describe('extractUploadImagePaths', () => {
  it('extracts relative upload paths and dedupes', () => {
    const html =
      '<img src="/uploads/banner.jpg"><img alt="x" src="/uploads/banner.jpg"><img src="/uploads/other.webp">';
    expect(extractUploadImagePaths(html).sort()).toEqual([
      '/uploads/banner.jpg',
      '/uploads/other.webp',
    ]);
  });

  it('normalizes absolute URLs to their upload path', () => {
    expect(
      extractUploadImagePaths('<img src="https://shop.example/uploads/banner.jpg">'),
    ).toEqual(['/uploads/banner.jpg']);
  });

  it('skips derivative URLs, external images and empty html', () => {
    expect(
      extractUploadImagePaths(
        '<img src="/uploads/derivatives/m1/large.webp"><img src="https://cdn.other.com/x.jpg">',
      ),
    ).toEqual([]);
    expect(extractUploadImagePaths('')).toEqual([]);
    expect(extractUploadImagePaths('<p>no images</p>')).toEqual([]);
  });

  it('strips query strings', () => {
    expect(extractUploadImagePaths('<img src="/uploads/banner.jpg?v=2">')).toEqual([
      '/uploads/banner.jpg',
    ]);
  });
});

describe('rewriteUploadImages', () => {
  it('swaps src to the large derivative and adds srcset + lazy attrs', () => {
    const out = rewriteUploadImages('<img src="/uploads/banner.jpg" alt="B">', MAP);
    expect(out).toContain('src="/uploads/derivatives/m1/large.webp"');
    expect(out).toContain('/uploads/derivatives/m1/small.webp 320w');
    expect(out).toContain('/uploads/derivatives/m1/medium.webp 640w');
    expect(out).toContain('/uploads/derivatives/m1/large.webp 1200w');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).toContain('alt="B"');
  });

  it('preserves single-quoted src and existing loading/srcset attributes', () => {
    const out = rewriteUploadImages(
      "<img src='/uploads/banner.jpg' loading='eager' srcset='custom 1x'>",
      MAP,
    );
    expect(out).toContain("src='/uploads/derivatives/m1/large.webp'");
    expect(out).toContain("loading='eager'");
    expect(out).toContain("srcset='custom 1x'");
    expect(out).not.toContain('loading="lazy"');
  });

  it('leaves images without a manifest untouched (fallback window)', () => {
    const html = '<img src="/uploads/legacy.png">';
    expect(rewriteUploadImages(html, MAP)).toBe(html);
    const unknown = '<img src="/uploads/unknown.jpg">';
    expect(rewriteUploadImages(unknown, MAP)).toBe(unknown);
  });

  it('leaves non-upload and derivative images untouched', () => {
    const html =
      '<img src="https://cdn.other.com/x.jpg"><img src="/uploads/derivatives/m1/large.webp">';
    expect(rewriteUploadImages(html, MAP)).toBe(html);
  });

  it('falls back down the ladder when large is missing', () => {
    const partial: DerivativeMap = {
      '/uploads/banner.jpg': {
        derivativeManifest: { medium: '/uploads/derivatives/m1/medium.webp' },
        blurUrl: null,
        updatedAt: new Date(),
      },
    };
    const out = rewriteUploadImages('<img src="/uploads/banner.jpg">', partial);
    expect(out).toContain('src="/uploads/derivatives/m1/medium.webp"');
    // Only one ladder entry -> no srcset injected.
    expect(out).not.toContain('srcset=');
  });
});
