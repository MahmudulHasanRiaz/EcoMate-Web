import { BadRequestException } from '@nestjs/common';

/**
 * Save-time validation for landing-page custom code (audit §4.5).
 *
 * Custom code is HTML structure + CSS styling ONLY — no JavaScript of any
 * kind. This is the fail-fast layer: it rejects forbidden constructs with
 * a 400 naming the exact construct, and reports EVERY violation in one
 * error so the admin (or the AI that generated the code) can fix them all
 * at once. The storefront's DOMPurify pass is the second, render-time
 * layer — this validator is what makes the AI loop work instead of
 * silently stripping.
 *
 * Forbidden HTML (`customHtml`): <script>, <iframe>, <object>, <embed>,
 * <form>, <link>, <meta>, <base>, <style> (CSS belongs in `customCss`),
 * <input>, <select>, <textarea>, <button>, <label>, <title>,
 * <noscript>, <template> (the platform renders the checkout form;
 * custom code must never build its own), any on* event-handler
 * attribute, `javascript:` / `vbscript:` / `data:text/html` URLs,
 * and `srcdoc`.
 *
 * Forbidden CSS (`customCss`): @import, @font-face, expression(,
 * javascript:, vbscript:, behavior:, -moz-binding, url(data:text/html.
 *
 * Size caps: customHtml 100 KB, customCss 50 KB (byte length).
 */

export const CUSTOM_HTML_MAX_BYTES = 100 * 1024;
export const CUSTOM_CSS_MAX_BYTES = 50 * 1024;

export interface CustomCodeInput {
  customHtml?: string | null;
  customCss?: string | null;
}

const FORBIDDEN_HTML_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'link',
  'meta',
  'base',
  'style',
  'input',
  'select',
  'textarea',
  'button',
  'label',
  'title',
  'noscript',
  'template',
] as const;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Validate custom HTML + CSS. Returns one message per violation found
 * (empty array = valid). Never throws — use {@link assertValidCustomCode}
 * for the fail-fast behaviour the service needs.
 */
export function validateCustomCode(input: CustomCodeInput): string[] {
  const violations: string[] = [];
  const html = asString(input?.customHtml);
  const css = asString(input?.customCss);

  // ── Size caps (byte length — what is actually stored) ──────────────
  if (html) {
    const bytes = Buffer.byteLength(html, 'utf8');
    if (bytes > CUSTOM_HTML_MAX_BYTES) {
      violations.push(
        `customHtml exceeds the 100 KB size limit (${bytes} bytes)`,
      );
    }
  }
  if (css) {
    const bytes = Buffer.byteLength(css, 'utf8');
    if (bytes > CUSTOM_CSS_MAX_BYTES) {
      violations.push(
        `customCss exceeds the 50 KB size limit (${bytes} bytes)`,
      );
    }
  }

  // ── HTML: forbidden tags (opening or closing) ───────────────────────
  for (const tag of FORBIDDEN_HTML_TAGS) {
    if (new RegExp(`<\\s*/?\\s*${tag}(?:\\s|>|/)`, 'i').test(html)) {
      violations.push(`customHtml contains a forbidden <${tag}> tag`);
    }
  }

  // ── HTML: per-tag attribute checks ──────────────────────────────────
  // Scoped to markup tags so the same words in visible text (e.g. a
  // paragraph explaining "don't use javascript: URLs") do not trip the
  // validator. Event handlers and URL schemes only execute inside tags.
  const tags = html.match(/<[^>]*>/g) ?? [];
  const seenHandlers = new Set<string>();
  let sawSrcdoc = false;
  let sawJavascriptUrl = false;
  let sawVbscriptUrl = false;
  let sawDataHtmlUrl = false;
  for (const tag of tags) {
    for (const m of tag.matchAll(/(?:^|[\s/])on([a-z]+)\s*=/gi)) {
      const name = `on${m[1].toLowerCase()}`;
      if (!seenHandlers.has(name)) {
        seenHandlers.add(name);
        violations.push(
          `customHtml contains a forbidden event-handler attribute "${name}"`,
        );
      }
    }
    if (!sawSrcdoc && /\ssrcdoc\s*=/i.test(tag)) {
      sawSrcdoc = true;
      violations.push(
        'customHtml contains a forbidden "srcdoc" attribute',
      );
    }
    if (!sawJavascriptUrl && /javascript\s*:/i.test(tag)) {
      sawJavascriptUrl = true;
      violations.push(
        'customHtml contains a forbidden "javascript:" URL',
      );
    }
    if (!sawVbscriptUrl && /vbscript\s*:/i.test(tag)) {
      sawVbscriptUrl = true;
      violations.push(
        'customHtml contains a forbidden "vbscript:" URL',
      );
    }
    if (!sawDataHtmlUrl && /data\s*:\s*text\/html/i.test(tag)) {
      sawDataHtmlUrl = true;
      violations.push(
        'customHtml contains a forbidden "data:text/html" URL',
      );
    }
  }

  // ── CSS: forbidden constructs ───────────────────────────────────────
  if (/@import\b/i.test(css)) {
    violations.push('customCss contains a forbidden "@import" rule');
  }
  if (/@font-face\b/i.test(css)) {
    violations.push('customCss contains a forbidden "@font-face" rule');
  }
  if (/expression\s*\(/i.test(css)) {
    violations.push('customCss contains a forbidden "expression("');
  }
  if (/javascript\s*:/i.test(css)) {
    violations.push('customCss contains a forbidden "javascript:" URL');
  }
  if (/vbscript\s*:/i.test(css)) {
    violations.push('customCss contains a forbidden "vbscript:" URL');
  }
  if (/behavior\s*:/i.test(css)) {
    violations.push('customCss contains a forbidden "behavior:" declaration');
  }
  if (/-moz-binding/i.test(css)) {
    violations.push('customCss contains a forbidden "-moz-binding"');
  }
  if (/url\s*\(\s*['"]?\s*data\s*:\s*text\/html/i.test(css)) {
    violations.push(
      'customCss contains a forbidden "url(data:text/html...)"',
    );
  }

  return violations;
}

/**
 * Fail fast: throw a single 400 listing every violation found, so the
 * admin + AI loop can fix them all in one round.
 */
export function assertValidCustomCode(input: CustomCodeInput): void {
  const violations = validateCustomCode(input);
  if (violations.length === 0) return;
  throw new BadRequestException(
    `Invalid custom code:\n${violations.map((v) => `- ${v}`).join('\n')}`,
  );
}
