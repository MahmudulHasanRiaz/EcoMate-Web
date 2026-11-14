import DOMPurify from 'isomorphic-dompurify';

/**
 * Custom-code sanitization for builder landing pages (audit §4.5).
 *
 * The security model is: custom code = HTML structure + scoped CSS only.
 * No JavaScript of any kind — no <script>, no event-handler attributes, no
 * javascript: URLs, no iframes/objects/embeds/forms. All commerce and
 * tracking are platform-provided (the platform renders the checkout form
 * into #ecomate-checkout-mount and fires PageView/ViewContent itself).
 *
 * Enforcement is two layers: save-time validation in the backend (fail
 * fast with precise 400s) and THIS render-time sanitization (defense in
 * depth — even a row written by direct API call or an older unsafe row
 * renders safe). The landing CSP is defense-in-depth on top; DOMPurify
 * is the control.
 *
 * Both functions are pure and side-effect-free, so they are unit-tested
 * directly (see __tests__/landing-sanitize.test.ts).
 */

// ── HTML ────────────────────────────────────────────────────────────────

// Safe structural / text / media tags only. Deliberately absent: script,
// iframe, object, embed, form, link, meta, base, style, title, button,
// and every form control (input/select/textarea/label) — the platform renders the
// checkout form; custom code must never build its own.
const LANDING_ALLOWED_TAGS = [
  'div', 'section', 'article', 'header', 'footer', 'main', 'nav',
  'span', 'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'img', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark',
  'br', 'hr', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption',
  'video', 'source', 'picture',
  'button',
];

// Safe attributes only. Deliberately absent: `style` (custom styling
// belongs in the separate Custom CSS field, which is scoped — see
// sanitizeLandingCss), and every on* handler (DOMPurify strips those by
// default; the tests lock it in). `id` stays: the platform checkout mount
// (<div id="ecomate-checkout-mount">) is expected inside custom HTML.
const LANDING_ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'id',
  'width', 'height', 'loading', 'target', 'rel',
  'controls', 'poster', 'preload', 'loop', 'muted', 'playsinline',
  'type', 'colspan', 'rowspan', 'start', 'value', 'open',
];

export function sanitizeLandingHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: LANDING_ALLOWED_TAGS,
    ALLOWED_ATTR: LANDING_ALLOWED_ATTR,
    // Belt-and-braces alongside the allowlist above: these tags are
    // removed. DOMPurify drops the contents of script/style/iframe/
    // embed/title/template outright; for the rest (form/button/label/
    // select/textarea/…) it unwraps the tag and only inert text survives
    // — no element, no attribute, nothing that can act.
    FORBID_TAGS: [
      'script', 'iframe', 'object', 'embed', 'form', 'link', 'meta',
      'base', 'style', 'title', 'input', 'select', 'textarea', 'label',
      'button', 'noscript', 'template',
    ],
    // DOMPurify's default URI check already rejects javascript: and
    // data:text/html URLs; on* attributes are stripped by default.
  });
}

// ── CSS ─────────────────────────────────────────────────────────────────

// A declaration is dropped when its value can execute code or load an
// active resource: IE expression(), javascript:/vbscript: URLs, the
// behavior: property and -moz-binding (both load executable code).
const DANGEROUS_DECLARATION =
  /expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding/i;
const DANGEROUS_URL =
  /url\s*\(\s*['"]?\s*(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/i;

// Split on a delimiter at depth 0 — parens/brackets/quotes aware, so a
// `;` inside content: "..." or a `,` inside :is(a, b) never splits.
function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === delimiter && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// Remove /* … */ comments, string-aware (a /* inside a quoted string is
// content, not a comment).
function stripCssComments(css: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < css.length) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < css.length) {
        out += css[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

interface TopLevelRule {
  prelude: string;
  // null = at-rule without a block (e.g. `@import …;`).
  body: string | null;
}

// Split CSS into top-level rules (prelude + balanced-brace body),
// string-aware. Trailing garbage and unparseable tails are dropped
// (fail closed) rather than passed through.
function splitTopLevelRules(css: string): TopLevelRule[] {
  const rules: TopLevelRule[] = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    while (i < n && /[\s;]/.test(css[i])) i++;
    if (i >= n) break;
    let j = i;
    let quote: string | null = null;
    let terminator: '{' | ';' | null = null;
    let preludeEnd = -1;
    while (j < n) {
      const ch = css[j];
      if (quote) {
        if (ch === '\\') j += 2;
        else {
          if (ch === quote) quote = null;
          j++;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        j++;
        continue;
      }
      if (ch === '{' || ch === ';') {
        preludeEnd = j;
        terminator = ch;
        break;
      }
      j++;
    }
    if (terminator === null) break;
    const prelude = css.slice(i, preludeEnd).trim();
    if (terminator === ';') {
      rules.push({ prelude, body: null });
      i = preludeEnd + 1;
      continue;
    }
    let depth = 1;
    let k = preludeEnd + 1;
    quote = null;
    let closed = false;
    while (k < n) {
      const ch = css[k];
      if (quote) {
        if (ch === '\\') k += 2;
        else {
          if (ch === quote) quote = null;
          k++;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        k++;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          closed = true;
          break;
        }
      }
      k++;
    }
    if (!closed) break;
    rules.push({ prelude, body: css.slice(preludeEnd + 1, k) });
    i = k + 1;
  }
  return rules;
}

function sanitizeDeclarations(body: string): string {
  return splitTopLevel(body, ';')
    .map((d) => d.trim())
    .filter((d) => {
      if (!d || !d.includes(':')) return false;
      if (d.includes('</')) return false;
      if (DANGEROUS_DECLARATION.test(d)) return false;
      if (DANGEROUS_URL.test(d)) return false;
      return true;
    })
    .join('; ');
}

// Prefix every selector in a list with `#landing-root`, so custom CSS can
// never restyle the page chrome, the checkout form outside the landing,
// or another landing. Selectors that already start with it are left
// alone (idempotent). Dead-on-arrival selectors (body, html, :root …)
// become `#landing-root body` etc. — harmless, they match nothing.
function scopeSelectorList(prelude: string): string | null {
  const scoped = splitTopLevel(prelude, ',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith('#landing-root')) return s;
      return `#landing-root ${s}`;
    });
  return scoped.length > 0 ? scoped.join(', ') : null;
}

function processRules(css: string): string {
  const out: string[] = [];
  for (const rule of splitTopLevelRules(css)) {
    const prelude = rule.prelude;
    if (!prelude) continue;
    if (rule.body === null) {
      // At-rule without a block — @import, @charset, … — always dropped.
      continue;
    }
    const lower = prelude.toLowerCase();
    if (lower.startsWith('@media') || lower.startsWith('@supports')) {
      // Recurse: the selectors inside get scoped the same way.
      const inner = processRules(rule.body);
      if (inner) out.push(`${prelude}{${inner}}`);
      continue;
    }
    if (lower.startsWith('@')) {
      // @font-face, @keyframes, @page, @property, … — dropped: anything
      // we cannot scope safely is dropped, never passed through.
      continue;
    }
    const scoped = scopeSelectorList(prelude);
    if (!scoped) continue;
    const decls = sanitizeDeclarations(rule.body);
    if (!decls) continue;
    out.push(`${scoped}{${decls}}`);
  }
  return out.join('\n');
}

// Scope custom CSS under #landing-root and drop everything dangerous or
// un-scopeable: @import / @font-face / @keyframes / other at-rules,
// expression( / javascript: / behavior: / -moz-binding, and any
// `</style` breakout attempt. Returns '' for empty/fully-dropped input.
export function sanitizeLandingCss(css: string): string {
  if (!css) return '';
  // A `</style` sequence would break out of the <style> element the CSS
  // is injected into and allow raw HTML — remove it before parsing.
  const noBreakout = css.replace(/<\/style/gi, '');
  return processRules(stripCssComments(noBreakout));
}
