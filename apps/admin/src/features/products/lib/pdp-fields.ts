export interface DetailRow {
  label: string;
  value: string;
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
