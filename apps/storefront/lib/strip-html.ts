// Plain-text meta descriptions from rich (HTML) product descriptions.
// Server-safe: no DOM, no dependencies — usable in generateMetadata.

export function toMetaDescription(html: string | undefined, fallback: string): string {
  const text = (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
  if (text.length <= 155) return text;
  return text.slice(0, 155).split(' ').slice(0, -1).join(' ') + '…';
}
