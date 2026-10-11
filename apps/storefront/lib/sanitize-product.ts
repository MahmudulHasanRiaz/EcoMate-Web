import DOMPurify from 'isomorphic-dompurify';

/**
 * PDP HTML sanitizer (extracted from ProductDetailClient so it is unit
 * testable). Plain-text descriptions keep EVERY line break: single `\n`
 * becomes `<br>`, runs of 2+ become paragraph splits — three consecutive
 * breaks stay visible spacing instead of collapsing.
 */
export function sanitizeProductHTML(html: string): string {
  const isHTML = /<[a-z][\s\S]*>/i.test(html);
  let processed = html.replace(/##/g, '');
  // Normalize all newline encodings first — WordPress imports often contain
  // literal "\n" (backslash-n) sequences, lone \r, or &#10;/&#xA; entities
  // that must become real line breaks.
  processed = processed
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/&#x0?A;/gi, '\n')
    .replace(/&#0?10;/gi, '\n');
  if (isHTML) {
    // HTML content: convert remaining newlines to <br>, but skip ones that
    // directly follow a block-close or existing <br> to avoid empty breaks.
    processed = processed.replace(/\n/g, (_m, offset, str) => {
      const before = (str as string).slice(0, offset as number);
      if (
        /<\/?(p|div|h[1-6]|ul|ol|li|table|blockquote|pre)[^>]*>\s*$/.test(
          before,
        ) ||
        /<br\s*\/?>\s*$/.test(before)
      ) {
        return '\n';
      }
      return '<br>';
    });
  } else {
    // Plain text: split paragraphs on 2+ breaks (each becomes <p> so every
    // break run stays visible), single breaks become <br> inside.
    processed = processed
      .split(/\n{2,}/)
      .map((para) =>
        `<p>${para.replace(/\n/g, '<br>').replace(/^<br>|<br>$/g, '')}</p>`,
      )
      .join('');
  }
  return DOMPurify.sanitize(processed, {
    ALLOWED_TAGS: [
      'b',
      'i',
      'em',
      'strong',
      'a',
      'p',
      'br',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'img',
      'span',
      'div',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    ALLOWED_ATTR: [
      'href',
      'target',
      'src',
      'alt',
      'class',
      'style',
      'width',
      'height',
    ],
  });
}
