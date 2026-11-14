import { describe, it, expect } from 'vitest';
import { sanitizeLandingCss, sanitizeLandingHtml } from '@/lib/landing-sanitize';

describe('sanitizeLandingHtml — strict allowlist, no JavaScript of any kind', () => {
  it('strips script tags WITH their contents', () => {
    const out = sanitizeLandingHtml('<p>Safe</p><script>alert(1)</script>');
    expect(out).toContain('Safe');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
  });

  it('strips iframes, objects, embeds and forms entirely', () => {
    const out = sanitizeLandingHtml(
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>' +
        '<object data="x"></object><embed src="x">' +
        '<form action="https://evil.example"><input name="phone"></form>',
    );
    expect(out).not.toMatch(/iframe|object|embed|form|input/i);
  });

  it('strips link/meta/base/style/title tags', () => {
    const out = sanitizeLandingHtml(
      '<link rel="stylesheet" href="https://evil.example/x.css">' +
        '<meta http-equiv="refresh" content="0;url=https://evil.example">' +
        '<base href="https://evil.example"><style>p{color:red}</style>' +
        '<title>evil</title><p>ok</p>',
    );
    expect(out).not.toMatch(/<link|<meta|<base|<style|<title/i);
    expect(out).toContain('ok');
  });

  it('strips every on* event-handler attribute', () => {
    const out = sanitizeLandingHtml(
      '<img src="x" onerror="alert(1)">' +
        '<svg onload="alert(2)"><circle /></svg>' +
        '<details open ontoggle="alert(3)"><summary>Q</summary>A</details>' +
        '<a href="https://example.com" onclick="alert(4)">click</a>',
    );
    expect(out).not.toMatch(/onerror|onload|ontoggle|onclick/i);
    expect(out).not.toContain('alert');
  });

  it('strips javascript: and data:text/html URLs, keeps https:', () => {
    const out = sanitizeLandingHtml(
      '<a href="javascript:alert(1)">bad</a>' +
        '<a href="data:text/html,<script>alert(2)</script>">bad2</a>' +
        '<a href="https://example.com/shop">good</a>',
    );
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('data:text/html');
    expect(out).toContain('https://example.com/shop');
  });

  it('keeps safe structural / text / media markup', () => {
    const out = sanitizeLandingHtml(
      '<section class="hero"><h1>Winter Sale</h1>' +
        '<p>Big <strong>discounts</strong> today.</p>' +
        '<ul><li>Free delivery</li><li>COD available</li></ul>' +
        '<img src="https://cdn.example.com/hero.jpg" alt="Hero" loading="lazy">' +
        '<a href="https://example.com/shop" target="_blank" rel="noopener">Shop now</a></section>',
    );
    expect(out).toContain('<h1>Winter Sale</h1>');
    expect(out).toContain('<strong>discounts</strong>');
    expect(out).toContain('Free delivery');
    expect(out).toContain('cdn.example.com/hero.jpg');
    expect(out).toContain('https://example.com/shop');
  });

  it('keeps the platform checkout mount div (id attribute allowed)', () => {
    const out = sanitizeLandingHtml('<div id="ecomate-checkout-mount"></div>');
    expect(out).toContain('id="ecomate-checkout-mount"');
  });

  it('strips style attributes and form controls (no fake checkout fields)', () => {
    const out = sanitizeLandingHtml(
      '<p style="position:fixed;top:0">overlay</p>' +
        '<input name="phone" placeholder="Your phone">' +
        '<button type="submit">Order</button>',
    );
    expect(out).not.toContain('style=');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('<button');
    // DOMPurify unwraps <button> and keeps its inert text ("Order") — the
    // tag is gone, so no fake submit button can render. Same for <form>.
    expect(out).not.toContain('<form');
    expect(out).toContain('overlay');
  });
});

describe('sanitizeLandingCss — scoped under #landing-root', () => {
  it('prefixes selectors with #landing-root', () => {
    const out = sanitizeLandingCss('.hero { color: red; } h1, .title { font-size: 2rem; }');
    expect(out).toContain('#landing-root .hero{color: red}');
    expect(out).toContain('#landing-root h1');
    expect(out).toContain('#landing-root .title');
  });

  it('does not double-prefix selectors that are already scoped', () => {
    const out = sanitizeLandingCss('#landing-root .hero { color: red; }');
    expect(out).toContain('#landing-root .hero');
    expect(out).not.toContain('#landing-root #landing-root');
  });

  it('drops @import and @font-face', () => {
    const out = sanitizeLandingCss(
      "@import url('https://evil.example/x.css'); " +
        "@font-face { font-family: X; src: url('https://evil.example/x.woff2'); } " +
        '.hero { color: red; }',
    );
    expect(out).not.toContain('@import');
    expect(out).not.toContain('@font-face');
    expect(out).toContain('#landing-root .hero');
  });

  it('drops @keyframes and other un-scopeable at-rules', () => {
    const out = sanitizeLandingCss(
      '@keyframes fade { from { opacity: 0; } to { opacity: 1; } } ' +
        '@page { margin: 0; } .hero { color: red; }',
    );
    expect(out).not.toContain('@keyframes');
    expect(out).not.toContain('@page');
    expect(out).toContain('#landing-root .hero');
  });

  it('recurses into @media and scopes the inner rules', () => {
    const out = sanitizeLandingCss('@media (max-width: 600px) { .hero { color: red; } }');
    expect(out).toContain('@media (max-width: 600px)');
    expect(out).toContain('#landing-root .hero');
  });

  it('drops expression( / javascript: / behavior: / -moz-binding declarations, keeps the rest', () => {
    const out = sanitizeLandingCss(
      '.a { width: expression(alert(1)); color: red; } ' +
        '.b { background: url(javascript:alert(2)); margin: 0; } ' +
        '.c { behavior: url(x.htc); padding: 0; } ' +
        '.d { -moz-binding: url(x.xml#x); border: 0; }',
    );
    expect(out).not.toMatch(/expression|javascript:|behavior|-moz-binding/i);
    expect(out).toContain('color: red');
    expect(out).toContain('margin: 0');
    expect(out).toContain('padding: 0');
    expect(out).toContain('border: 0');
  });

  it('strips </style breakout attempts', () => {
    const out = sanitizeLandingCss('.a { color: red; }</style><img src=x onerror=alert(1)>');
    expect(out).not.toContain('</style');
    expect(out).not.toContain('<img');
    expect(out).toContain('#landing-root .a');
  });

  it('returns empty for empty or fully-dropped input', () => {
    expect(sanitizeLandingCss('')).toBe('');
    expect(sanitizeLandingCss("@import url('https://evil.example/x.css');")).toBe('');
  });

  it('drops an unparseable tail instead of passing it through', () => {
    const out = sanitizeLandingCss('.a { color: red; } .b { color: blue;');
    expect(out).toContain('#landing-root .a');
    expect(out).not.toContain('.b');
  });
});
