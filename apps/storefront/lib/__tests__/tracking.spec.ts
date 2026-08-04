import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackEvent, setPixelIds, initMetaPixel, setPixelIdentity, setConsent, setTrackingConsent, isTrackingAllowed, trackPageView } from '../tracking';

describe('tracking', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    // One assignment per cookie: the document.cookie setter only stores the
    // first name=value pair from a single assignment (spec-compliant in jsdom
    // and real browsers alike).
    document.cookie = '_fbp=fb.1.1.1; path=/';
    document.cookie = '_fbc=fb.1.2.3; path=/';
    // Clear any opt-out cookie a previous test left behind — cookies outlive
    // localStorage.clear(), and the module reads it at load time.
    document.cookie = 'ecomate_tracking_optout=; Max-Age=0; path=/';
    document.cookie = 'ecomate_tracking_optout=; Max-Age=0;';
    vi.restoreAllMocks();

    // Reset Wave-2.3 consent state to the default (not required → allowed) so
    // consent-gating tests are isolated from each other.
    setConsent(false, true);

    // Fresh pixel mocks, then assign pixel ids. Any events left queued by a
    // previous test flush into these fresh mocks, so clear them afterwards.
    window.fbq = vi.fn();
    window.ttq = { track: vi.fn(), page: vi.fn() };
    setPixelIds('TEST-META-ID', 'TEST-TIKTOK-CODE');
    initMetaPixel(); // mark the Meta pixel as inited so trackEvent takes the live path
    vi.mocked(window.fbq).mockClear();
    vi.mocked(window.ttq.track).mockClear();

    fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
  });

  it('uses the provided eventId for the Meta pixel eventID', () => {
    trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');
    expect(window.fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 100 }, { eventID: 'purchase_ord-1' });
  });

  it('uses the provided eventId for the TikTok pixel event_id', () => {
    trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');
    expect(window.ttq.track).toHaveBeenCalledWith('CompletePayment', { value: 100 }, { event_id: 'purchase_ord-1' });
  });

  it('mirrors the provided eventId into the /tracking/events POST body', () => {
    trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/tracking/events');
    const body = JSON.parse(init!.body as string);
    expect(body.eventId).toBe('purchase_ord-1');
    expect(body.eventName).toBe('purchase');
  });

  it('carries the eventId override through the pre-init queue', () => {
    setPixelIds('', ''); // clear pixel ids so trackEvent queues instead of firing
    window.fbq = vi.fn();
    trackEvent('Purchase', { value: 100 }, {}, 'purchase_queued-1');
    expect(window.fbq).not.toHaveBeenCalled();
    setPixelIds('TEST-META-ID', ''); // flush the queue
    expect(window.fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 100 }, { eventID: 'purchase_queued-1' });
  });

  it('generates a deterministic journey-scoped eventId when no override is provided (Wave-2.5 R-B)', () => {
    trackEvent('Purchase', { value: 100 });
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/tracking/events');
    const body = JSON.parse(init!.body as string);
    expect(body.eventId).toBeDefined();
    // deterministic, not random: {event}_{contentKey}_{journeyHash}_{5sBucket}
    expect(body.eventId).toMatch(/^purchase_n_[0-9a-f]{8}_\d+$/);
    // The same id must drive the pixel eventID so both stay consistent.
    expect(window.fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 100 }, { eventID: body.eventId });
  });

  it('derives a stable deterministic eventId for the same event+content (R-B dedup)', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      trackEvent('AddToCart', { content_ids: ['sku-1'] });
      const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
      expect(first).toMatch(/^add_to_cart_sku-1_[0-9a-f]{8}_\d+$/);

      // Re-fire within the same bucket + same content -> identical id, so the
      // server/Meta dedup the accidental duplicate instead of double-counting.
      trackEvent('AddToCart', { content_ids: ['sku-1'] });
      const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
      expect(second).toBe(first);

      // A different content key within the journey -> a different id.
      trackEvent('AddToCart', { content_ids: ['sku-2'] });
      const third = JSON.parse(fetchMock.mock.calls[2][1].body as string).eventId;
      expect(third).not.toBe(first);
    } finally {
      spy.mockRestore();
    }
  });

  // --- Wave-2.3 consent / opt-out gating ---

  it('fires by default (no consent required, no opt-out cookie)', () => {
    trackEvent('AddToCart', { value: 1 });
    expect(window.fbq).toHaveBeenCalledWith('track', 'AddToCart', { value: 1 }, expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/tracking/events'), expect.anything());
  });

  it('suppresses events when consent is required but no grant is stored', () => {
    localStorage.removeItem('ecomate_tracking_consent');
    setConsent(true, false); // required + no stored 'granted' → not allowed
    expect(isTrackingAllowed()).toBe(false);

    trackEvent('AddToCart', { value: 1 });
    expect(window.fbq).not.toHaveBeenCalled();
    // Mirror POST suppressed too — nothing leaves the client.
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/tracking/events'), expect.anything());
  });

  it('fires once tracking consent is granted', () => {
    setConsent(true, false);
    setTrackingConsent(true); // banner grants consent
    expect(isTrackingAllowed()).toBe(true);

    trackEvent('AddToCart', { value: 1 });
    expect(window.fbq).toHaveBeenCalledWith('track', 'AddToCart', { value: 1 }, expect.anything());
  });

  it('suppresses everything when the opt-out cookie is present at module load', async () => {
    vi.resetModules();
    document.cookie = 'ecomate_tracking_optout=1; path=/';
    window.fbq = vi.fn();
    window.ttq = { track: vi.fn() };
    window.gtag = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    const fresh = await import('../tracking');

    expect(fresh.isTrackingAllowed()).toBe(false);

    // initMetaPixel must no-op (no PageView, no init) under opt-out.
    fresh.setPixelIds('FRESH-META', '');
    fresh.initMetaPixel();
    expect(window.fbq).not.toHaveBeenCalled();

    fresh.trackEvent('AddToCart', { value: 9 });
    expect(window.fbq).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('setTrackingConsent persists to localStorage and flips the gate state', () => {
    setConsent(true, false);
    expect(isTrackingAllowed()).toBe(false);

    setTrackingConsent(true);
    expect(localStorage.getItem('ecomate_tracking_consent')).toBe('granted');
    expect(isTrackingAllowed()).toBe(true);

    setTrackingConsent(false);
    expect(localStorage.getItem('ecomate_tracking_consent')).toBe('revoked');
    expect(isTrackingAllowed()).toBe(false);
  });

  it('trackPageView fires a browser PageView and de-dupes the same URL', () => {
    vi.mocked(window.fbq).mockClear();
    const initialUrl = window.location.href;

    trackPageView();
    expect(window.fbq).toHaveBeenCalledWith('track', 'PageView');

    vi.mocked(window.fbq).mockClear();
    trackPageView(); // same URL again → de-duped
    expect(window.fbq).not.toHaveBeenCalled();
    expect(window.location.href).toBe(initialUrl);

    // In-SPA navigation to a new URL fires again.
    window.history.pushState({}, '', '/my-second-route');
    trackPageView();
    expect(window.fbq).toHaveBeenCalledWith('track', 'PageView');
  });

  it('trackPageView is suppressed and fires nothing when tracking is not allowed', () => {
    setConsent(true, false);
    window.history.pushState({}, '', '/my-third-route');
    trackPageView();
    expect(window.fbq).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/tracking/events'), expect.anything());
  });

  it('setPixelIdentity after init does not double-fire init', async () => {
    vi.resetModules();
    window.fbq = vi.fn();
    window.ttq = { track: vi.fn() };
    const fresh = await import('../tracking');

    fresh.setPixelIds('META', '');
    fresh.initMetaPixel();
    const fbqCalls = () => (window.fbq as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === 'init').length;
    expect(fbqCalls()).toBe(1);

    // Identity (external_id + em + ph) arriving after init is stored for the
    // next load — Meta cannot re-init mid-session (extend gracefully, no double
    // init / double PageView).
    fresh.setPixelIdentity('ext-late', 'em-late', 'ph-late');
    fresh.initMetaPixel();
    expect(fbqCalls()).toBe(1);
    expect(window.fbq).toHaveBeenCalledWith('init', 'META', undefined);
  });
});
