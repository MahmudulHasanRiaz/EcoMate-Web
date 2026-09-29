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

  describe('Google and the other platforms that used to fall through to DIRECT', () => {
    it('Google Ads (utm_source=google + cpc) → GOOGLE/AD', () => {
      expect(
        resolveWebAttribution({ utmSource: 'google', utmMedium: 'cpc' }),
      ).toEqual({ sourcePlatform: 'GOOGLE', sourceType: 'AD' });
    });

    it('Google Ads shorthand sources resolve to GOOGLE', () => {
      for (const utmSource of ['googleads', 'adwords']) {
        expect(
          resolveWebAttribution({ utmSource, utmMedium: 'cpc' }),
        ).toEqual({ sourcePlatform: 'GOOGLE', sourceType: 'AD' });
      }
    });

    it('gclid / wbraid / gbraid → GOOGLE/AD without any utm', () => {
      for (const field of ['gclid', 'wbraid', 'gbraid'] as const) {
        expect(resolveWebAttribution({ [field]: 'x' })).toEqual({
          sourcePlatform: 'GOOGLE',
          sourceType: 'AD',
        });
      }
    });

    it('msclkid → BING/AD, twclid → TWITTER/AD', () => {
      expect(resolveWebAttribution({ msclkid: 'm' })).toEqual({
        sourcePlatform: 'BING',
        sourceType: 'AD',
      });
      expect(resolveWebAttribution({ twclid: 't' })).toEqual({
        sourcePlatform: 'TWITTER',
        sourceType: 'AD',
      });
    });

    it('organic search referrers resolve to their engine, as DIRECT', () => {
      const cases: Array<[string, string]> = [
        ['https://www.google.com/search?q=x', 'GOOGLE'],
        ['https://google.com.bd/', 'GOOGLE'],
        ['https://www.bing.com/search?q=x', 'BING'],
        ['https://www.youtube.com/watch?v=1', 'YOUTUBE'],
        ['https://duckduckgo.com/?q=x', 'DUCKDUCKGO'],
        ['https://www.linkedin.com/feed/', 'LINKEDIN'],
        ['https://t.co/abc', 'TWITTER'],
      ];
      for (const [referrer, platform] of cases) {
        expect(resolveWebAttribution({ referrer })).toEqual({
          sourcePlatform: platform,
          sourceType: 'DIRECT',
        });
      }
    });

    it('a paid medium on a non-ad platform (chat link, email) stays DIRECT', () => {
      expect(
        resolveWebAttribution({ utmSource: 'whatsapp', utmMedium: 'cpc' }),
      ).toEqual({ sourcePlatform: 'WHATSAPP', sourceType: 'DIRECT' });
      expect(
        resolveWebAttribution({ utmSource: 'messenger', utmMedium: 'paid' }),
      ).toEqual({ sourcePlatform: 'MESSENGER', sourceType: 'DIRECT' });
    });

    it('a click id still wins when the utm_source is unknown', () => {
      expect(
        resolveWebAttribution({ utmSource: 'unknown-source', gclid: 'g' }),
      ).toEqual({ sourcePlatform: 'GOOGLE', sourceType: 'AD' });
    });
  });
});