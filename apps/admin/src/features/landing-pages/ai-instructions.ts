/**
 * Single shared source for the custom-code security contract.
 *
 * The Prompt Reference modal, the "Copy AI instructions" action, and the
 * copy in the custom-code tab ALL read from this file — so the modal, the
 * copied text, and (by design) the backend validator / storefront DOMPurify
 * allowlist can never drift apart.
 *
 * Contract (audit §4.5/§4.6, 2026-11-14): custom code is HTML structure +
 * plain CSS only. NO JavaScript of any kind. Tracking and checkout are
 * platform-provided and fire automatically.
 *
 * NOTE FOR THE BACKEND/STOREFRONT IMPLEMENTERS: the allowlists below
 * (ALLOWED_HTML_TAGS / ALLOWED_HTML_ATTRIBUTES / FORBIDDEN_CSS) are the
 * exact lists the save-time validator and the render-time DOMPurify pass
 * must enforce. If either side needs a change, change it HERE first and
 * mirror it in the validator/sanitizer in the same commit.
 */

/** Tags the sanitizer keeps. Everything else (script, iframe, form, input,
 *  object, embed, link, meta, base, style, button, select, textarea, …)
 *  is stripped/rejected. */
export const ALLOWED_HTML_TAGS = [
  'a',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'small',
  'mark',
  'span',
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'br',
  'hr',
  'img',
  'video',
  'source',
  'picture',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
  'code',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'nav',
  'details',
  'summary',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
] as const

/** Attributes the sanitizer keeps. No `on*` event handlers, no `style`
 *  attribute (all styling goes in the separate Custom CSS field), and
 *  `href`/`src` values may only use http(s): (plus mailto:/tel: for links) —
 *  never `javascript:` or `vbscript:`. */
export const ALLOWED_HTML_ATTRIBUTES = [
  'class',
  'id',
  'href',
  'src',
  'alt',
  'title',
  'width',
  'height',
  'loading',
  'target',
  'rel',
  'controls',
  'loop',
  'muted',
  'playsinline',
  'poster',
  'preload',
  'type',
  'colspan',
  'rowspan',
  'start',
  'value',
  'open',
] as const

/** Constructs the save-time validator rejects (400, naming the construct)
 *  and the render-time sanitizer strips. */
export const FORBIDDEN_HTML_CONSTRUCTS = [
  '<script> tags',
  'event-handler attributes (onclick, onerror, onload, …)',
  'javascript: URLs',
  '<iframe>, <object> and <embed>',
  '<form>, <input>, <select>, <textarea> and <button>',
  '<link>, <meta> and <base>',
  '<style> tags (CSS goes in the separate Custom CSS field)',
  'fetch() / XMLHttpRequest / EcoMate.* calls',
] as const

/** CSS rules the save-time validator rejects and the sanitizer drops. */
export const FORBIDDEN_CSS_CONSTRUCTS = [
  '@import',
  '@font-face',
  'javascript: URLs',
  'vbscript: URLs',
  'expression(',
  'behavior:',
  '-moz-binding',
] as const

export const CHECKOUT_MOUNT_HTML = '<div id="ecomate-checkout-mount"></div>'

export const CSS_SCOPE_SELECTOR = '#landing-root'

export interface AiInstructionSection {
  title: string
  content: string
}

/**
 * The sections shown in the Prompt Reference modal. The copied
 * instructions are built FROM these sections (see buildAiInstructions),
 * so modal and copy can never disagree.
 */
export const AI_INSTRUCTION_SECTIONS: AiInstructionSection[] = [
  {
    title: 'Output format — HTML fragment only',
    content:
      'Output an HTML FRAGMENT only — the content that goes inside the page body. ' +
      'Never output a full document: no <!DOCTYPE html>, no <html>, no <head>, no <body>. ' +
      'Never output a <script> tag and never output a <style> tag. ' +
      'All styling goes in the separate Custom CSS field as plain CSS (see "Custom CSS" below). ' +
      'The platform wraps your fragment in the page; anything outside the fragment is discarded.',
  },
  {
    title: 'No JavaScript — ever',
    content:
      'There is NO JavaScript in custom code. No <script> tags, no event-handler attributes ' +
      '(no onclick, onerror, onload, ontoggle, …), no javascript: URLs, no fetch() or ' +
      'XMLHttpRequest, no EcoMate.* calls, no window.EcoMate, no localStorage / sessionStorage / ' +
      'cookies / eval. Code that needs JavaScript cannot run on this page by design — ' +
      'do not write it, do not work around it, and do not ask the user to enable it. ' +
      'If an interaction needs script (countdown, variant picker, quantity stepper, form ' +
      'validation), leave a plain HTML placeholder with a comment and say so in your reply; ' +
      'the platform provides the interactive parts.',
  },
  {
    title: 'Checkout — platform-rendered, never build your own form',
    content:
      'Checkout lives at exactly this element, which you must include ONCE where the order ' +
      'form should appear:\n\n<div id="ecomate-checkout-mount"></div>\n\n' +
      'The platform renders the real checkout form (name, phone, address, delivery zone, ' +
      'payment, Cash on Delivery) into that mount point and submits orders itself. ' +
      'Never build your own order form, never write a submit button that posts an order, ' +
      'never call any order API. Do not duplicate the form, do not wrap the mount point in ' +
      'another <form>, and do not add inputs that collect order details.',
  },
  {
    title: 'Products — assigned in the Products tab, rendered by the platform',
    content:
      'Products are assigned in the admin Products tab and rendered by the platform. ' +
      'Do NOT render product cards, prices, compare-at prices, stock counts, variant ' +
      'selectors, or quantity steppers yourself — the platform renders the assigned ' +
      'products (with their real prices and stock) next to your content. ' +
      'Write only the marketing sections: hero, benefits, features, testimonials, FAQ, ' +
      'trust badges, footer. Refer to products by name in text only, never with a price.',
  },
  {
    title: 'Allowed HTML tags & attributes',
    content:
      'Only these tags are kept; everything else is stripped or rejected on save:\n' +
      `Tags: ${ALLOWED_HTML_TAGS.join(', ')}.\n` +
      `Attributes: ${ALLOWED_HTML_ATTRIBUTES.join(', ')}.\n` +
      'Forbidden, always:\n' +
      FORBIDDEN_HTML_CONSTRUCTS.map((c) => `• ${c}`).join('\n') +
      '\nLinks may use https:, http:, mailto: and tel: only. Images may use https: URLs only.',
  },
  {
    title: 'Custom CSS — plain CSS only, scoped, no Tailwind',
    content:
      'Write PLAIN CSS only — never Tailwind classes (Tailwind is not loaded for custom ' +
      `code, so class="text-red-500" etc. does nothing). All custom CSS is scoped under ${CSS_SCOPE_SELECTOR} ` +
      '— write selectors as if they are already inside it (e.g. `.hero { … }`, not ' +
      `'#landing-root .hero { … })'. ` +
      'Forbidden in CSS:\n' +
      FORBIDDEN_CSS_CONSTRUCTS.map((c) => `• ${c}`).join('\n') +
      '\nNo external fonts: the platform font stack is the only font source. ' +
      'Use the brand colour from the page settings; do not hardcode a different brand colour.',
  },
  {
    title: 'Images & links',
    content:
      'Images: https: URLs only (upload images to the Media Library and use the URL it ' +
      'gives you). Always set alt text on <img>. Links that open a new tab must use ' +
      'target="_blank" rel="noopener". No tracking pixels, no external scripts, no iframes ' +
      '(including YouTube embeds — link to the video instead).',
  },
  {
    title: 'Tracking — automatic, do not fire events',
    content:
      'Tracking (PageView, ViewContent) is fired automatically by the platform. ' +
      'Do NOT call any tracking function, do NOT add tracking pixels, and do NOT fire ' +
      'events on click, scroll, or form input. There is nothing to wire up.',
  },
]

/**
 * The full structured instruction block a user pastes into ANY AI together
 * with their requirements. Built from AI_INSTRUCTION_SECTIONS so the copied
 * text always matches the Prompt Reference modal.
 */
export function buildAiInstructions(requirements = ''): string {
  const req = requirements.trim()
  const sections = AI_INSTRUCTION_SECTIONS.map(
    (s) => `## ${s.title}\n${s.content}`,
  ).join('\n\n')
  return [
    'You are building a custom landing page for EcoMate (an e-commerce storefront in Bangladesh).',
    'Follow the security contract below EXACTLY. If a requirement conflicts with the contract, the contract wins — say so and offer the closest safe alternative.',
    '',
    '# Security contract (must follow exactly)',
    '',
    sections,
    '',
    '# Your requirements',
    req || '[Describe your page here: audience, sections, headline, offer, language (Bengali/English), colours, images.]',
    '',
    'Return TWO blocks: (1) the HTML fragment, (2) the plain CSS for the Custom CSS field. Nothing else.',
  ].join('\n')
}
