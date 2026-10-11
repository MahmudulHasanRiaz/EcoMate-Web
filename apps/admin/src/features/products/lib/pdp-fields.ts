export interface DetailRow {
  label: string;
  value: string;
}

export interface DescriptionSections {
  tagline?: string;
  benefits?: string[];
  specifications?: string;
  stylingTip?: string;
}

const YT =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})|^([a-zA-Z0-9_-]{11})$/;
const FB =
  /facebook\.com\/(?:watch\/?\?v=\d+|reel\/\d+|video\/\d+|share\/\d+|plugins\/video\.php\?href=)|fb\.watch\/|facebook\.com\/[^/]+\/videos\/\d+/;

/** Admin-side check for the optional product video URL (YouTube/Facebook only). Empty = valid (field optional). */
export function isSupportedVideoUrl(url: string): boolean {
  const t = (url || '').trim();
  if (!t) return true;
  return YT.test(t) || FB.test(t);
}

/** Trim rows and drop empties; order preserved. */
export function cleanDetailRows(rows: DetailRow[]): DetailRow[] {
  return (rows || [])
    .map((r) => ({ label: (r.label || '').trim(), value: (r.value || '').trim() }))
    .filter((r) => r.label && r.value);
}

/**
 * Normalize the Description Sections group: trim all strings, drop empty
 * benefits, omit empty fields. Returns undefined when the whole group is
 * empty so the storefront hides every section.
 */
export function cleanDescriptionSections(input: {
  tagline: string;
  benefits: string[];
  specifications: string;
  stylingTip: string;
}): DescriptionSections | undefined {
  const tagline = (input.tagline || '').trim();
  const benefits = (input.benefits || [])
    .map((b) => (b || '').trim())
    .filter(Boolean);
  const specifications = (input.specifications || '').trim();
  const stylingTip = (input.stylingTip || '').trim();
  const out: DescriptionSections = {};
  if (tagline) out.tagline = tagline;
  if (benefits.length > 0) out.benefits = benefits;
  if (specifications) out.specifications = specifications;
  if (stylingTip) out.stylingTip = stylingTip;
  return Object.keys(out).length > 0 ? out : undefined;
}
