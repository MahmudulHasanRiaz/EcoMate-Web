import { describe, it, expect } from 'vitest';
import { toMetaDescription } from '@/lib/strip-html';

describe('toMetaDescription (P3-4/1.6)', () => {
  it('strips HTML tags and collapses whitespace', () => {
    expect(toMetaDescription('<p>Hello<br>  world</p>', 'fallback')).toBe('Hello world');
  });

  it('falls back when input is empty', () => {
    expect(toMetaDescription('', 'fallback text')).toBe('fallback text');
    expect(toMetaDescription(undefined, 'fallback text')).toBe('fallback text');
  });

  it('truncates at a word boundary with an ellipsis instead of cutting mid-word', () => {
    const long = `<p>${'word '.repeat(60)}</p>`;
    const out = toMetaDescription(long, 'fallback');
    expect(out).not.toMatch(/<|>/);
    expect(out).toBe(`${'word '.repeat(31).trim()}…`);
  });

  it('returns short text untouched', () => {
    expect(toMetaDescription('Short plain text', 'fallback')).toBe('Short plain text');
  });
});
