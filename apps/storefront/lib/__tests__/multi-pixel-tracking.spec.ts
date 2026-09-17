import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Step 3 — multi-pixel browser fan-out.
 *
 * A fresh module instance per test is required: `tracking.ts` keeps `_metaInited`
 * and the pixel-id list in module state, and `_metaInited` is deliberately sticky
 * for the lifetime of a page. Importing through `vi.resetModules()` gives each test
 * an un-initialized module, which is the only way to assert on the init sequence.
 */
describe('tracking — multi-pixel Meta fan-out (Step 3)', () => {
  let tracking: typeof import('../tracking');
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = '_fbp=fb.1.1.1; path=/';
    document.cookie = '_fbc=fb.1.2.3; path=/';
    document.cookie = 'ecomate_tracking_optout=; Max-Age=0; path=/';
    document.cookie = 'ecomate_tracking_optout=; Max-Age=0;';
    vi.restoreAllMocks();
    window.fbq = vi.fn();
    window.ttq = { track: vi.fn(), page: vi.fn() };
    fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    tracking = await import('../tracking');
    tracking.setConsent(false, true);
  });

  it('initializes EVERY enabled pixel before firing a single PageView', () => {
    tracking.setPixelIds(['PIXEL-A', 'PIXEL-B', 'PIXEL-C'], '');
    tracking.initMetaPixel();

    const calls = vi.mocked(window.fbq!).mock.calls;
    const initCalls = calls.filter((c: any) => c[0] === 'init');
    expect(initCalls.map((c: any) => c[1])).toEqual(['PIXEL-A', 'PIXEL-B', 'PIXEL-C']);
    // Exactly ONE PageView call — fbq fans it out to every initialized pixel.
    // Looping would have multiplied PageView per pixel instead.
    const pageViews = calls.filter((c: any) => c[0] === 'track' && c[1] === 'PageView');
    expect(pageViews).toHaveLength(1);
  });

  it('passes the same Advanced Matching object to every pixel', () => {
    tracking.setPixelIds(['PIXEL-A', 'PIXEL-B'], '');
    tracking.setPixelIdentity('ext-1', 'em-hash', 'ph-hash', null);
    tracking.initMetaPixel();

    const initCalls = vi
      .mocked(window.fbq!)
      .mock.calls.filter((c: any) => c[0] === 'init');
    expect(initCalls).toHaveLength(2);
    expect(initCalls[0][2]).toEqual(initCalls[1][2]);
    expect(initCalls[0][2]).toMatchObject({ external_id: 'ext-1', em: 'em-hash', ph: 'ph-hash' });
  });

  it('sends the canonical Purchase event id to every pixel via ONE fbq call', () => {
    tracking.setPixelIds(['PIXEL-A', 'PIXEL-B'], '');
    tracking.initMetaPixel();
    vi.mocked(window.fbq!).mockClear();

    tracking.trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');

    const purchaseCalls = vi
      .mocked(window.fbq!)
      .mock.calls.filter((c: any) => c[0] === 'track' && c[1] === 'Purchase');
    // ONE call carrying the canonical id; fbq itself duplicates it across every
    // initialized pixel with the same eventID (that identity is what dedups each
    // pixel's browser event against its CAPI event).
    expect(purchaseCalls).toHaveLength(1);
    expect(purchaseCalls[0][3]).toEqual({ eventID: 'purchase_ord-1' });
  });

  it('does not initialize any pixel when the id list is empty', () => {
    tracking.setPixelIds([], '');
    tracking.initMetaPixel();
    expect(window.fbq).not.toHaveBeenCalled();
  });

  it('accepts a single string id for backward compatibility', () => {
    tracking.setPixelIds('PIXEL-LEGACY', '');
    tracking.initMetaPixel();
    const initCalls = vi
      .mocked(window.fbq!)
      .mock.calls.filter((c: any) => c[0] === 'init');
    expect(initCalls.map((c: any) => c[1])).toEqual(['PIXEL-LEGACY']);
  });

  it('filters empty/whitespace pixel ids out of the list', () => {
    tracking.setPixelIds(['PIXEL-A', '', '   ', 'PIXEL-B'], '');
    tracking.initMetaPixel();
    const initCalls = vi
      .mocked(window.fbq!)
      .mock.calls.filter((c: any) => c[0] === 'init');
    expect(initCalls.map((c: any) => c[1])).toEqual(['PIXEL-A', 'PIXEL-B']);
  });

  it('keeps provider-level Purchase mode: validated suppresses ALL Meta pixels', () => {
    tracking.setPixelIds(['PIXEL-A', 'PIXEL-B'], '');
    tracking.setTrackingConfig('validated', 'instant');
    tracking.initMetaPixel();
    vi.mocked(window.fbq!).mockClear();

    tracking.trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');

    const purchaseCalls = vi
      .mocked(window.fbq!)
      .mock.calls.filter((c: any) => c[0] === 'track' && c[1] === 'Purchase');
    expect(purchaseCalls).toHaveLength(0);
    // Non-Purchase events are unaffected by the Purchase-mode gate.
    tracking.trackEvent('ViewContent', { value: 10 });
    expect(
      vi.mocked(window.fbq!).mock.calls.some((c: any) => c[1] === 'ViewContent'),
    ).toBe(true);
  });

  it('fires the Purchase across every pixel when the provider mode is instant', () => {
    tracking.setPixelIds(['PIXEL-A', 'PIXEL-B'], '');
    tracking.setTrackingConfig('instant', 'validated');
    tracking.initMetaPixel();
    vi.mocked(window.fbq!).mockClear();

    tracking.trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');

    expect(
      vi.mocked(window.fbq!).mock.calls.filter((c: any) => c[1] === 'Purchase'),
    ).toHaveLength(1);
  });

  it('mirrors the canonical event id without leaking any destination identity', () => {
    tracking.setPixelIds(['PIXEL-A', 'PIXEL-B'], '');
    tracking.initMetaPixel();
    tracking.trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');

    // initMetaPixel now also mirrors its own PageView (shared event_id for
    // CAPI dedup) — locate the Purchase mirror specifically.
    const bodies = fetchMock.mock.calls.map((c: any) => JSON.parse(c[1]!.body as string));
    const body = bodies.find((b: any) => b.eventId === 'purchase_ord-1');
    expect(body).toBeDefined();
    expect(body!.eventId).toBe('purchase_ord-1');
    // Destination fan-out is decided server-side; the browser must not carry a
    // destination/pixel identity (that is what prevents Pixel A → CAPI B pairing).
    expect(JSON.stringify(body)).not.toContain('PIXEL-A');
    expect(JSON.stringify(body)).not.toContain('PIXEL-B');
    expect(body).not.toHaveProperty('destinationId');
    expect(body).not.toHaveProperty('pixelId');
  });

  it('holds events in the queue until every pixel is initialized', () => {
    tracking.setPixelIds(['PIXEL-A', 'PIXEL-B'], '');
    tracking.trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');
    expect(window.fbq).not.toHaveBeenCalled();

    tracking.initMetaPixel();

    expect(
      vi.mocked(window.fbq!).mock.calls.filter((c: any) => c[1] === 'Purchase'),
    ).toHaveLength(1);
  });
});
