import type { MediaMeta } from "./types";

/**
 * P3: resolve a derivative URL preferring the AVIF sibling in the
 * manifest (`<variant>_avif`, additive key added by the backend in P3).
 * Pre-P3 manifests have no `_avif` keys → falls back to the plain
 * (WebP) variant, then to the original URL. The custom image loader
 * (lib/image-loader.ts) then maps the chosen URL to the closest size
 * variant for the requested width, preserving the extension — so an
 * AVIF base URL yields AVIF at every width, a WebP base yields WebP.
 */
export function resolveDerivativeUrl(
  mediaMeta: MediaMeta | undefined,
  url: string,
  variant: string,
): string {
  if (!url) return url;
  const manifest = mediaMeta?.[url]?.derivativeManifest;
  if (!manifest) return url;
  return manifest[`${variant}_avif`] || manifest[variant] || url;
}

/** Per-image 16×16 blur data URL stored by the backend, if present. */
export function resolveBlurUrl(
  mediaMeta: MediaMeta | undefined,
  url: string,
): string | null {
  const blur = mediaMeta?.[url]?.blurUrl;
  return blur && blur.startsWith("data:") ? blur : null;
}
