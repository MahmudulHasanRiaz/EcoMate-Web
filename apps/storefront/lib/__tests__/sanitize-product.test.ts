import { describe, it, expect } from 'vitest';
import { sanitizeProductHTML } from '../sanitize-product';

describe('sanitizeProductHTML', () => {
  it('keeps single line breaks as <br>', () => {
    expect(sanitizeProductHTML('a\nb')).toContain('a<br>b');
  });

  it('keeps three consecutive breaks as visible spacing (no collapse)', () => {
    const out = sanitizeProductHTML('a\n\n\nb');
    expect(out).toContain('a');
    expect(out).toContain('b');
    // two paragraph gaps must survive — collapsed output would be shorter
    const gaps = (out.match(/<\/?p[ >]/g) || []).length;
    expect(gaps).toBeGreaterThanOrEqual(4); // <p>a</p><p></p><p>b</p>
  });

  it('does not inject empty breaks after block tags in HTML input', () => {
    const out = sanitizeProductHTML('<p>hi</p>\nbye');
    expect(out).not.toMatch(/<\/p><br>/);
    expect(out).toContain('bye');
  });
});
