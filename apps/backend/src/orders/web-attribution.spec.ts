import { resolveWebAttribution } from './web-attribution';

describe('Web attribution resolver (spec §20-21)', () => {
  it('direct traffic → DIRECT/DIRECT when no signal maps', () => {
    expect(resolveWebAttribution({})).toEqual({
      sourcePlatform: 'DIRECT',
      sourceType: 'DIRECT',
    });
    expect(resolveWebAttribution(null)).toBeNull();
    expect(resolveWebAttribution(undefined)).toBeNull();
  });

  it('utm_source=direct → DIRECT/DIRECT', () => {
    expect(resolveWebAttribution({ utmSource: 'direct' })).toEqual({
      sourcePlatform: 'DIRECT',
      sourceType: 'DIRECT',
    });
  });

  it('Facebook ad (utm_source=facebook + cpc) → FACEBOOK/AD', () => {
    expect(
      resolveWebAttribution({ utmSource: 'facebook', utmMedium: 'cpc' }),
    ).toEqual({ sourcePlatform: 'FACEBOOK', sourceType: 'AD' });
  });

  it('Instagram ad (utm_source=instagram + paid) → INSTAGRAM/AD', () => {
    expect(
      resolveWebAttribution({ utmSource: 'instagram', utmMedium: 'paid' }),
    ).toEqual({ sourcePlatform: 'INSTAGRAM', sourceType: 'AD' });
  });

  it('TikTok organic (utm_source=tiktok, no medium) → TIKTOK/DIRECT', () => {
    expect(resolveWebAttribution({ utmSource: 'tiktok' })).toEqual({
      sourcePlatform: 'TIKTOK',
      sourceType: 'DIRECT',
    });
  });

  it('fbclid → FACEBOOK/AD even without utm', () => {
    expect(resolveWebAttribution({ fbclid: 'xyz' })).toEqual({
      sourcePlatform: 'FACEBOOK',
      sourceType: 'AD',
    });
  });

  it('ttclid → TIKTOK/AD; igshid → INSTAGRAM/AD', () => {
    expect(resolveWebAttribution({ ttclid: 't' })).toEqual({
      sourcePlatform: 'TIKTOK',
      sourceType: 'AD',
    });
    expect(resolveWebAttribution({ igshid: 'ig' })).toEqual({
      sourcePlatform: 'INSTAGRAM',
      sourceType: 'AD',
    });
  });

  it('facebook.com referrer → FACEBOOK/DIRECT (organic social)', () => {
    expect(resolveWebAttribution({ referrer: 'https://www.facebook.com/abc' })).toEqual({
      sourcePlatform: 'FACEBOOK',
      sourceType: 'DIRECT',
    });
  });

  it('instagram.com + threads.net referrers resolve to their platforms', () => {
    expect(resolveWebAttribution({ referrer: 'https://www.instagram.com/p/1' })).toEqual({
      sourcePlatform: 'INSTAGRAM',
      sourceType: 'DIRECT',
    });
    expect(resolveWebAttribution({ referrer: 'https://www.threads.net/@x' })).toEqual({
      sourcePlatform: 'THREADS',
      sourceType: 'DIRECT',
    });
  });

  it('unknown utm_source is not claimed as a platform', () => {
    const result = resolveWebAttribution({ utmSource: 'newsletter' });
    // Never fabricate a platform: sourceType reflects the referrer if known,
    // otherwise DIRECT defaults.
    expect(result).toBeDefined();
    expect(result?.sourcePlatform).toBe('DIRECT');
  });

  it('precedence: recognized utm_source beats click id and referrer', () => {
    expect(
      resolveWebAttribution({
        utmSource: 'instagram',
        utmMedium: 'cpc',
        fbclid: 'x',
        referrer: 'https://www.facebook.com/',
      }),
    ).toEqual({ sourcePlatform: 'INSTAGRAM', sourceType: 'AD' });
  });

  it('precedence: click id beats referrer', () => {
    expect(
      resolveWebAttribution({
        ttclid: 't',
        referrer: 'https://www.facebook.com/',
      }),
    ).toEqual({ sourcePlatform: 'TIKTOK', sourceType: 'AD' });
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(resolveWebAttribution({ utmSource: ' FACEBOOK ', utmMedium: 'CPC' })).toEqual({
      sourcePlatform: 'FACEBOOK',
      sourceType: 'AD',
    });
  });
});