import {
  AVIF_OPTIONS,
  generateDerivatives,
  manifestMissingAvif,
} from '../derivatives';

/**
 * P3 AVIF derivatives. Uses REAL sharp (backend dependency) on a
 * generated photo-like sample so the byte assertions are meaningful.
 *
 * Measured while choosing AVIF_OPTIONS (sharp 0.35, 2026-11-03):
 *   photo 1200w: webp q80 13,688B · avif q60/e3 11,758B (−14%) · q60/e4 10,633B but 3.3× slower
 *   photo  640w: webp 5,548B · avif q60/e3 4,855B (−12%)
 *   texture 1200w: webp 281,158B · avif q60/e3 208,047B (−26%) · q60/e4 210,339B (larger, 2.9× slower)
 * Effort 3 is the queue-safe choice; effort 4 gave no consistent win.
 */
describe('generateDerivatives (P3 AVIF)', () => {
  jest.setTimeout(60_000);

  it('emits webp + avif for every size, avif smaller than webp on a photo-like sample', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const width = 1200;
    const height = 900;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        raw[i] = Math.max(0, Math.min(255, 180 + 60 * Math.sin(x / 90)));
        raw[i + 1] = Math.max(0, Math.min(255, 120 + 50 * Math.sin((x + y) / 120)));
        raw[i + 2] = Math.max(0, Math.min(255, 90 + 40 * Math.cos(x / 50)));
      }
    }
    const original: Buffer = await sharp(raw, {
      raw: { width, height, channels: 3 },
    })
      .jpeg({ quality: 92 })
      .toBuffer();

    const stored = new Map<string, Buffer>();
    const { manifest, blurUrl } = await generateDerivatives({
      sharp,
      original,
      mediaId: 'test-media',
      needsJpegFallback: false,
      store: async (key, buf) => {
        stored.set(key, buf);
        return `/uploads/${key}`;
      },
    });

    for (const size of ['thumbnail', 'small', 'medium', 'large']) {
      expect(manifest[size]).toBe(`/uploads/derivatives/test-media/${size}.webp`);
      expect(manifest[`${size}_avif`]).toBe(
        `/uploads/derivatives/test-media/${size}.avif`,
      );
      expect(manifest[`${size}_jpg`]).toBeUndefined();
    }
    expect(blurUrl).toMatch(/^data:image\/webp;base64,/);

    const webpLarge = stored.get('derivatives/test-media/large.webp')!;
    const avifLarge = stored.get('derivatives/test-media/large.avif')!;
    expect(avifLarge.length).toBeGreaterThan(0);
    expect(avifLarge.length).toBeLessThan(webpLarge.length);
    // AVIF magic: bytes 4..12 contain 'ftypavif' (or mif1 brand family)
    const brand = avifLarge.subarray(4, 12).toString('ascii');
    expect(brand.startsWith('ftyp')).toBe(true);

    expect(AVIF_OPTIONS).toEqual({ quality: 60, effort: 3 });
  });

  it('keeps the JPEG fallback keys for non-native sources', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const original: Buffer = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 40, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();
    const { manifest } = await generateDerivatives({
      sharp,
      original,
      mediaId: 'm2',
      needsJpegFallback: true,
      store: async (key) => `/uploads/${key}`,
    });
    expect(manifest.small_jpg).toBe('/uploads/derivatives/m2/small.jpg');
    expect(manifest.small_avif).toBe('/uploads/derivatives/m2/small.avif');
  });
});

describe('manifestMissingAvif', () => {
  it('flags pre-P3 manifests and passes P3 / empty ones', () => {
    expect(manifestMissingAvif({ small: 'a.webp', large: 'b.webp' })).toBe(true);
    expect(
      manifestMissingAvif({ small: 'a.webp', small_avif: 'a.avif' }),
    ).toBe(false);
    expect(manifestMissingAvif(null)).toBe(false);
    expect(manifestMissingAvif({})).toBe(false);
    expect(manifestMissingAvif({ blur: 'x' })).toBe(false);
  });
});
