/**
 * JSON for embedding inside an inline <script> tag.
 *
 * SECURITY (2026-10-25): plain JSON.stringify is NOT safe here — a product
 * name, FAQ answer or tracking value containing "</script>" closes the
 * script element early and the rest parses as HTML, i.e. a stored-XSS
 * breakout. Escaping <, > and & (plus U+2028/U+2029, which are line
 * terminators in JS strings) keeps the JSON valid while making it
 * impossible to break out of the script element. Use this for EVERY
 * dangerouslySetInnerHTML JSON payload — never raw JSON.stringify.
 */
export function stringifyForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
