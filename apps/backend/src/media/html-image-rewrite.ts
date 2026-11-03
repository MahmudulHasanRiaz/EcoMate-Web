import type { DerivativeMap } from './media-resolver.service';

/**
 * Stored-HTML image guardrail (scale program, 2026-11-04).
 *
 * Rich-text content stored in the DB (CMS page bodies, product
 * descriptions / specifications) can embed <img> tags that point at the
 * ORIGINAL upload (`/uploads/<file>`). Those bypass the derivative
 * pipeline entirely — a client embedding a 2.5MB banner photo in a CMS
 * page would serve all 2.5MB to every visitor, whatever the rest of the
 * system does. This helper rewrites such tags at READ time (the stored
 * HTML is never modified, so the admin editor keeps round-tripping the
 * original markup):
 *
 *   src    -> the `large` WebP derivative (ladder fallback medium/small)
 *   srcset -> the WebP ladder (320w / 640w / 1200w) when absent
 *   loading="lazy" + decoding="async" when absent
 *
 * Images whose media has no derivative manifest yet (upload still
 * processing, or a legacy row the boot backfill has not reached) are
 * left untouched — the original serves as the fallback until the
 * manifest exists, then the rewrite takes over automatically.
 *
 * Manifest key convention mirrors MediaResolverService.resolveFormat:
 * `<variant>` = WebP, `<variant>_avif` = AVIF, `<variant>_jpg` = JPEG.
 * Ladder widths: thumbnail 150 / small 320 / medium 640 / large 1200.
 */

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /((?:^|\s)src\s*=\s*)("([^"]*)"|'([^']*)')/i;

function normalizeUploadPath(src: string | undefined): string | null {
  if (!src) return null;
  const idx = src.indexOf('/uploads/');
  if (idx < 0) return null;
  const path = src.slice(idx).split(/[?#]/)[0];
  if (path.startsWith('/uploads/derivatives/')) return null;
  return path;
}

/** Unique original-upload paths referenced by <img src> in the HTML. */
export function extractUploadImagePaths(html: string): string[] {
  if (!html || !html.includes('/uploads/')) return [];
  const paths = new Set<string>();
  for (const tag of html.match(IMG_TAG_RE) ?? []) {
    const m = tag.match(SRC_ATTR_RE);
    const path = normalizeUploadPath(m?.[3] ?? m?.[4]);
    if (path) paths.add(path);
  }
  return [...paths];
}

/** Rewrite <img> tags whose original has derivatives in the map. */
export function rewriteUploadImages(html: string, map: DerivativeMap): string {
  if (!html || !html.includes('/uploads/')) return html;
  return html.replace(IMG_TAG_RE, (tag) => {
    const m = tag.match(SRC_ATTR_RE);
    if (!m) return tag;
    const path = normalizeUploadPath(m[3] ?? m[4]);
    if (!path) return tag;
    const manifest = map[path]?.derivativeManifest;
    if (!manifest) return tag;

    const large = manifest['large'] ?? manifest['medium'] ?? manifest['small'];
    if (!large) return tag;

    const quote = m[2].startsWith("'") ? "'" : '"';
    let out = tag.replace(
      SRC_ATTR_RE,
      (_full, prefix: string) => `${prefix}${quote}${large}${quote}`,
    );

    if (!/\ssrcset\s*=/i.test(out)) {
      const entries: string[] = [];
      if (manifest['small']) entries.push(`${manifest['small']} 320w`);
      if (manifest['medium']) entries.push(`${manifest['medium']} 640w`);
      if (manifest['large']) entries.push(`${manifest['large']} 1200w`);
      if (entries.length > 1) {
        out = out.replace(
          /<img\b/i,
          `<img srcset="${entries.join(', ')}" sizes="(max-width: 900px) 100vw, 900px"`,
        );
      }
    }
    if (!/\sloading\s*=/i.test(out)) {
      out = out.replace(/<img\b/i, '<img loading="lazy"');
    }
    if (!/\sdecoding\s*=/i.test(out)) {
      out = out.replace(/<img\b/i, '<img decoding="async"');
    }
    return out;
  });
}
