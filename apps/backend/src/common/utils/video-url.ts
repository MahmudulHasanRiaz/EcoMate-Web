const YT =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})|^([a-zA-Z0-9_-]{11})$/;
const FB =
  /facebook\.com\/(?:watch\/?\?v=\d+|reel\/\d+|video\/\d+|share\/\d+|plugins\/video\.php\?href=)|fb\.watch\/|facebook\.com\/[^/]+\/videos\/\d+/;

export function isSupportedVideoUrl(url: string): boolean {
  const t = (url || '').trim();
  if (!t) return false;
  return YT.test(t) || FB.test(t);
}
