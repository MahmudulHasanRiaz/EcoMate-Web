/**
 * Derivative generation for uploaded images (P3, speed plan §6).
 *
 * Manifest shape — BACKWARD COMPATIBLE, additive only:
 *   { thumbnail, small, medium, large }            -> WebP URL (unchanged, pre-P3)
 *   { thumbnail_avif, small_avif, … }              -> AVIF sibling (new in P3)
 *   { thumbnail_jpg, … }                           -> JPEG fallback for
 *                                                     non-native sources (pre-P3)
 * Old rows have no `*_avif` keys; every consumer must fall back to the
 * plain (WebP) key. `MediaResolverService.resolveFormat` does that.
 *
 * AVIF settings — measured 2026-11-03 on sharp 0.35 (libvips), see the
 * spec in __tests__/derivatives.spec.ts for the harness numbers:
 * sharp's AVIF defaults are quality 50 / effort 4
 * (sharp.pixelplumbing.com/api-output#avif). Effort 4 was 3–10× slower
 * than effort 3 in our samples and NOT consistently smaller (on a
 * detailed texture it produced a *larger* file — cf. sharp#3418), so
 * this queue uses effort 3. Quality 60 measured 14–30% smaller than
 * WebP q80 across 320/640/1200w samples; quality 50 saved more but is
 * a visible step down from the existing WebP q80 bar.
 */
export const DERIVATIVE_SIZES = [
  { name: 'thumbnail', width: 150 },
  { name: 'small', width: 320 },
  { name: 'medium', width: 640 },
  { name: 'large', width: 1200 },
] as const;

export type DerivativeSizeName = (typeof DERIVATIVE_SIZES)[number]['name'];

export const WEBP_QUALITY = 80;
export const AVIF_OPTIONS = { quality: 60, effort: 3 } as const;

export type DerivativeStoreFn = (
  key: string,
  buf: Buffer,
  contentType: string,
) => Promise<string>;

/** Minimal structural subset of sharp used here (keeps unit tests light). */
export interface SharpLike {
  (input: Buffer): {
    resize: (...args: any[]) => any;
    metadata: () => Promise<any>;
  };
}

export async function generateDerivatives(opts: {
  sharp: SharpLike;
  original: Buffer;
  mediaId: string;
  needsJpegFallback: boolean;
  store: DerivativeStoreFn;
  onAvifError?: (size: string, err: Error) => void;
}): Promise<{ manifest: Record<string, string>; blurUrl: string }> {
  const { sharp, original, mediaId, needsJpegFallback, store } = opts;
  const manifest: Record<string, string> = {};

  for (const size of DERIVATIVE_SIZES) {
    const webpBuf = await sharp(original)
      .resize({ width: size.width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    manifest[size.name] = await store(
      `derivatives/${mediaId}/${size.name}.webp`,
      webpBuf,
      'image/webp',
    );

    // AVIF is additive: a failure here must never fail the whole job —
    // the WebP derivative above remains the servable fallback.
    try {
      const avifBuf = await sharp(original)
        .resize({ width: size.width, withoutEnlargement: true })
        .avif({ ...AVIF_OPTIONS })
        .toBuffer();
      manifest[`${size.name}_avif`] = await store(
        `derivatives/${mediaId}/${size.name}.avif`,
        avifBuf,
        'image/avif',
      );
    } catch (err) {
      opts.onAvifError?.(size.name, err as Error);
    }

    if (needsJpegFallback) {
      const jpegBuf = await sharp(original)
        .resize({ width: size.width, withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      manifest[`${size.name}_jpg`] = await store(
        `derivatives/${mediaId}/${size.name}.jpg`,
        jpegBuf,
        'image/jpeg',
      );
    }
  }

  const blurWebp = await sharp(original)
    .resize(16, 16, { fit: 'cover' })
    .webp({ quality: 20 })
    .toBuffer();
  const blurUrl = `data:image/webp;base64,${blurWebp.toString('base64')}`;

  return { manifest, blurUrl };
}

/** True when a manifest carries at least one usable WebP size variant. */
export function manifestHasUsableDerivative(
  manifest: Record<string, unknown> | null | undefined,
): boolean {
  if (!manifest || typeof manifest !== 'object') return false;
  return (
    typeof manifest.small === 'string' || typeof manifest.large === 'string'
  );
}

/** True when a manifest predates P3 (has WebP sizes but no AVIF sibling). */
export function manifestMissingAvif(
  manifest: Record<string, unknown> | null | undefined,
): boolean {
  if (!manifest || typeof manifest !== 'object') return false;
  if (typeof manifest.small !== 'string' && typeof manifest.large !== 'string')
    return false;
  return typeof manifest.small_avif !== 'string' &&
    typeof manifest.large_avif !== 'string';
}
