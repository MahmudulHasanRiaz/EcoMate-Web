// Pure helpers shared by the pre-formatted page templates. No DOM, no React
// imports — safe to import from registry.ts and server components alike.

export interface PageMeta {
  /** Row updatedAt (ISO string) — the single source for "Last updated". */
  updatedAt?: string;
  /** Admin-set effective date (ISO string) when the document takes effect. */
  effectiveDate?: string | null;
  /** Document version number, shown next to the last-updated line. */
  version?: number;
}

export function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

export function slugify(text: string): string {
  return (text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Stable id for a policy section. Prefers the admin-set `id` (survives a
 * heading rename); falls back to a slug of the heading for rows written
 * before the id field existed, then to a positional id. The slug fallback is
 * a legacy bridge, not the rule — new sections should always carry an id.
 */
export function sectionId(
  section: { id?: unknown; heading?: unknown },
  index: number,
): string {
  if (hasText(section?.id)) return String(section.id).trim();
  if (hasText(section?.heading)) return slugify(String(section.heading));
  return `section-${index + 1}`;
}

/**
 * Last-updated formatting. Deliberately locale/timezone-free: no hardcoded
 * `en-GB` / `Asia/Dhaka` — the runtime default locale applies. Returns ""
 * for a missing or invalid date so callers can omit the line entirely.
 */
export function formatPageDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HTML_TAG = /<[a-z][\s>]/i;

/**
 * Normalises a policy section body for rendering. Bodies are edited with the
 * admin rich-text editor (HTML) since this round; rows written before that
 * were plain text. HTML bodies pass through unchanged (the caller sanitizes);
 * plain-text bodies get blank-line paragraphs wrapped in <p> tags so old
 * rows keep their paragraph breaks.
 */
export function richTextToHtml(body: string): string {
  if (!hasText(body)) return "";
  if (HTML_TAG.test(body)) return body;
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
    .join("");
}
