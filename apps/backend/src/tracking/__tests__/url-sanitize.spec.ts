import { sanitizeTrackingUrl } from '../url-sanitize';

describe('sanitizeTrackingUrl (privacy P0)', () => {
  it('strips sensitive query params from a thank-you URL (view token + orderId)', () => {
    expect(
      sanitizeTrackingUrl(
        'https://www.fixedplus.com.bd/checkout/thank-you?orderId=8d47efe2-d162-420d-87cb-8f30fe6d2d3a&t=586274ac-051b-440e-8799-a852451286a0',
      ),
    ).toBe('https://www.fixedplus.com.bd/checkout/thank-you');
  });

  it('strips token/key/access_token/orderId query params generically', () => {
    expect(sanitizeTrackingUrl('https://ecomate.example/x?token=abc&key=k')).toBe(
      'https://ecomate.example/x',
    );
    expect(
      sanitizeTrackingUrl('https://ecomate.example/y?orderId=ORD-1&t=tok'),
    ).toBe('https://ecomate.example/y');
    expect(
      sanitizeTrackingUrl('https://ecomate.example/z?access_token=zzz'),
    ).toBe('https://ecomate.example/z');
  });

  it('strips fragment identifiers (implicit-flow tokens)', () => {
    expect(
      sanitizeTrackingUrl('https://ecomate.example/cb#access_token=secret'),
    ).toBe('https://ecomate.example/cb');
  });

  it('keeps scheme, host and pathname', () => {
    expect(sanitizeTrackingUrl('https://ecomate.example/products/abc')).toBe(
      'https://ecomate.example/products/abc',
    );
  });

  it('strips query from relative paths', () => {
    expect(sanitizeTrackingUrl('/checkout/thank-you?orderId=x&t=y')).toBe(
      '/checkout/thank-you',
    );
  });

  it('returns undefined for empty/missing input', () => {
    expect(sanitizeTrackingUrl(undefined)).toBeUndefined();
    expect(sanitizeTrackingUrl(null)).toBeUndefined();
    expect(sanitizeTrackingUrl('')).toBeUndefined();
    expect(sanitizeTrackingUrl('   ')).toBeUndefined();
  });

  it('leaves non-URL values without query untouched (no throw)', () => {
    expect(sanitizeTrackingUrl('plain-value')).toBe('plain-value');
    expect(sanitizeTrackingUrl('fb.1.abc')).toBe('fb.1.abc');
  });

  it('caps extremely long inputs', () => {
    const long = `https://ecomate.example/${'a'.repeat(5000)}?t=secret`;
    const out = sanitizeTrackingUrl(long)!;
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out).not.toContain('secret');
    expect(out).not.toContain('?');
  });

  it('strips query on any http(s) URL with valid attribution params too (policy = whole query)', () => {
    // Whole-query policy: attribution lives in dedicated structured fields
    // (fbp/fbc cookies, MarketingSession utm columns) — never in persisted URLs.
    expect(
      sanitizeTrackingUrl(
        'https://ecomate.example/products/a?fbclid=fb.1.9.8&utm_source=fb&utm_medium=cpc',
      ),
    ).toBe('https://ecomate.example/products/a');
  });
});
