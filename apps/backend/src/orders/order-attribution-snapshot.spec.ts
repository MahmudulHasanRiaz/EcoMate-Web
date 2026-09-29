import {
  buildOrderAttributionSnapshot,
  DEFAULT_ATTRIBUTION_WINDOW_DAYS,
  ATTRIBUTION_SNAPSHOT_VERSION,
} from './order-attribution-snapshot';

/**
 * The snapshot is the order's own immutable copy of where it came from. These
 * tests lock the precedence (order payload wins, session is only a fallback) and
 * the "null means nothing was known" contract.
 */
describe('buildOrderAttributionSnapshot', () => {
  const NOW = new Date('2026-09-29T10:00:00.000Z');

  it('returns null when the order carries no signal at all', () => {
    expect(buildOrderAttributionSnapshot({ now: NOW })).toBeNull();
    expect(
      buildOrderAttributionSnapshot({ attribution: {}, device: {}, now: NOW }),
    ).toBeNull();
    expect(
      buildOrderAttributionSnapshot({ attribution: { utmSource: '  ' }, now: NOW }),
    ).toBeNull();
  });

  it('records the payload signals verbatim', () => {
    const snapshot = buildOrderAttributionSnapshot({
      attribution: {
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'brand_bd',
        utmContent: 'ad-123',
        utmTerm: 'eco bag',
        referrer: 'https://www.google.com/',
        gclid: 'Cj0KCQ',
      },
      resolved: { sourcePlatform: 'GOOGLE', sourceType: 'AD' },
      now: NOW,
    });

    expect(snapshot).toMatchObject({
      version: ATTRIBUTION_SNAPSHOT_VERSION,
      capturedAt: NOW.toISOString(),
      referrer: 'https://www.google.com/',
      utm: {
        source: 'google',
        medium: 'cpc',
        campaign: 'brand_bd',
        content: 'ad-123',
        term: 'eco bag',
      },
      clickIds: { gclid: 'Cj0KCQ' },
      resolved: { platform: 'GOOGLE', type: 'AD' },
      touch: { lastTouchAt: NOW.toISOString(), windowDays: DEFAULT_ATTRIBUTION_WINDOW_DAYS },
    });
  });

  it('prefers the order payload over the journey session, per field', () => {
    const snapshot = buildOrderAttributionSnapshot({
      attribution: { utmSource: 'tiktok' },
      session: { utmSource: 'facebook', utmCampaign: 'from-session', referrer: 'https://fb.com' },
      now: NOW,
    });

    // payload source wins; the fields the payload did not carry fall back.
    expect(snapshot?.utm.source).toBe('tiktok');
    expect(snapshot?.utm.campaign).toBe('from-session');
    expect(snapshot?.referrer).toBe('https://fb.com');
  });

  it('uses the session as a fallback when the payload is empty', () => {
    const snapshot = buildOrderAttributionSnapshot({
      attribution: {},
      session: {
        utmSource: 'facebook',
        clickId: 'fb-1',
        referrer: 'https://l.facebook.com',
        landingUrl: 'https://shop.example/?utm_source=facebook',
        ip: '203.0.113.9',
        userAgent: 'Mozilla/5.0 (session)',
      },
      sessionToken: 'ctx-1',
      now: NOW,
    });

    expect(snapshot).toMatchObject({
      sessionToken: 'ctx-1',
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (session)',
      clickIds: { clickId: 'fb-1' },
      landingUrl: 'https://shop.example/?utm_source=facebook',
    });
    expect(snapshot?.utm.source).toBe('facebook');
  });

  it('prefers the request IP/UA over the session copy', () => {
    const snapshot = buildOrderAttributionSnapshot({
      ip: '198.51.100.7',
      userAgent: 'Mozilla/5.0 (request)',
      session: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (session)' },
      now: NOW,
    });

    expect(snapshot?.ip).toBe('198.51.100.7');
    expect(snapshot?.userAgent).toBe('Mozilla/5.0 (request)');
  });

  it('keeps every click-id spelling that arrived, compacted', () => {
    const snapshot = buildOrderAttributionSnapshot({
      attribution: {
        fbclid: 'fb',
        gclid: 'g',
        wbraid: '',
        msclkid: 'ms',
        clickId: 'generic',
      },
      now: NOW,
    });

    expect(snapshot?.clickIds).toEqual({
      clickId: 'generic',
      fbclid: 'fb',
      gclid: 'g',
      msclkid: 'ms',
    });
  });

  it('records a device block and drops empty values', () => {
    const snapshot = buildOrderAttributionSnapshot({
      device: {
        screen: '390x844',
        viewport: '390x664',
        timezone: 'Asia/Dhaka',
        language: 'bn-BD',
        os: 'Android',
        deviceType: 'mobile',
        touch: true,
        browser: '',
      },
      now: NOW,
    });

    expect(snapshot?.device).toEqual({
      screen: '390x844',
      viewport: '390x664',
      timezone: 'Asia/Dhaka',
      language: 'bn-BD',
      os: 'Android',
      deviceType: 'mobile',
      touch: true,
    });
  });

  it('records the touch model without changing attribution', () => {
    const snapshot = buildOrderAttributionSnapshot({
      attribution: { utmSource: 'facebook' },
      sessionStartedAt: new Date('2026-09-20T10:00:00.000Z'),
      attributionWindowDays: 30,
      now: NOW,
    });

    expect(snapshot?.touch).toEqual({
      firstSeenAt: '2026-09-20T10:00:00.000Z',
      lastTouchAt: NOW.toISOString(),
      ageDays: 9,
      windowDays: 30,
      withinWindow: true,
    });
  });

  it('flags a first touch that falls outside the window', () => {
    const snapshot = buildOrderAttributionSnapshot({
      attribution: { utmSource: 'facebook' },
      sessionStartedAt: new Date('2026-06-01T10:00:00.000Z'),
      attributionWindowDays: 30,
      now: NOW,
    });

    expect(snapshot?.touch.withinWindow).toBe(false);
    expect(snapshot?.touch.windowDays).toBe(30);
  });

  it('reports an unknown touch age when no session start is known', () => {
    const snapshot = buildOrderAttributionSnapshot({
      attribution: { utmSource: 'facebook' },
      sessionStartedAt: null,
      now: NOW,
    });

    expect(snapshot?.touch).toMatchObject({
      firstSeenAt: null,
      ageDays: null,
      withinWindow: null,
      windowDays: DEFAULT_ATTRIBUTION_WINDOW_DAYS,
    });
  });

  it('ignores a malformed window setting and falls back to the default', () => {
    const snapshot = buildOrderAttributionSnapshot({
      attribution: { utmSource: 'facebook' },
      attributionWindowDays: 0,
      now: NOW,
    });

    expect(snapshot?.touch.windowDays).toBe(DEFAULT_ATTRIBUTION_WINDOW_DAYS);
  });
});
