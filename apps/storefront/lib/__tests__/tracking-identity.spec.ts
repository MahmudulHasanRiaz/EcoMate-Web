import { describe, it, expect, vi } from 'vitest';

/**
 * Wave-2.1 production-validation (module level). Deterministic simulation of the
 * Meta pixel init + identity timing semantics that the staging scenarios depend
 * on (guest init, authenticated init with external_id, buffering under a slow
 * identity lookup, graceful degradation on identity failure, logout). Each test
 * uses a fresh module instance (vi.resetModules) so initMetaPixel's idempotency
 * does not leak between scenarios. Live network/Meta-side checks (Test Events,
 * Events Manager, real fbq delivery) are out of scope here and are validated in
 * the credentialed staging checklist.
 */
async function freshTracking() {
  vi.resetModules();
  window.fbq = vi.fn();
  window.ttq = { track: vi.fn() };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
  return await import('../tracking');
}

describe('tracking identity init — production-validation scenarios', () => {
  it('guest: inits without external_id, PageView fires synchronously (no artificial delay)', async () => {
    const t = await freshTracking();
    const fbq = window.fbq as ReturnType<typeof vi.fn>;

    t.setPixelIds('META', '');
    // initMetaPixel is synchronous: no await, no timer — guests have no identity
    // fetch, so the init is not artificially delayed.
    t.initMetaPixel();

    expect(fbq).toHaveBeenCalledWith('init', 'META', undefined);
    expect(fbq).toHaveBeenCalledWith('track', 'PageView');
  });

  it('authenticated at init: first PageView carries the correct external_id', async () => {
    const t = await freshTracking();
    const fbq = window.fbq as ReturnType<typeof vi.fn>;

    t.setPixelIdentity('ext-1');
    t.setPixelIds('META', '');
    t.initMetaPixel();

    expect(fbq).toHaveBeenCalledWith('init', 'META', { external_id: 'ext-1' });
    expect(fbq).toHaveBeenCalledWith('track', 'PageView');
  });

  it('slow identity endpoint: events buffer (not sent early, not lost) and flush after init', async () => {
    const t = await freshTracking();
    const fbq = window.fbq as ReturnType<typeof vi.fn>;

    t.setPixelIds('META', '');
    // Event fired before identity resolves / before init.
    t.trackEvent('ViewContent', { value: 100 });
    // _metaInited is false until initMetaPixel runs -> buffered, not fired yet.
    expect(fbq).not.toHaveBeenCalledWith(
      'track',
      'ViewContent',
      { value: 100 },
      expect.anything(),
    );

    t.setPixelIdentity('ext-1');
    t.initMetaPixel();
    expect(fbq).toHaveBeenCalledWith('init', 'META', { external_id: 'ext-1' });
    expect(fbq).toHaveBeenCalledWith('track', 'ViewContent', { value: 100 }, {
      eventID: expect.stringMatching(/^view_content_.*_[0-9a-f]{8}_\d+$/),
    });
  });

  it('identity endpoint failure: init proceeds without external_id and tracking continues', async () => {
    const t = await freshTracking();
    const fbq = window.fbq as ReturnType<typeof vi.fn>;

    t.setPixelIds('META', '');
    t.trackEvent('ViewContent', { value: 200 }); // buffered
    t.setPixelIdentity(null); // identity lookup failed / flag off
    t.initMetaPixel();

    expect(fbq).toHaveBeenCalledWith('init', 'META', undefined);
    expect(fbq).toHaveBeenCalledWith('track', 'ViewContent', { value: 200 }, expect.anything());
    // A later event still fires (tracking is not stopped by a failed identity lookup).
    t.trackEvent('AddToCart', { value: 5 });
    expect(fbq).toHaveBeenCalledWith('track', 'AddToCart', { value: 5 }, expect.anything());
  });

  it('logout mid-session: events still fire; external_id stays fixed at init (Meta limitation)', async () => {
    const t = await freshTracking();
    const fbq = window.fbq as ReturnType<typeof vi.fn>;

    t.setPixelIdentity('ext-1');
    t.setPixelIds('META', '');
    t.initMetaPixel();
    expect(fbq).toHaveBeenCalledWith('init', 'META', { external_id: 'ext-1' });

    // Log out without refresh: clearing identity does not stop tracking; the
    // init-time external_id cannot be removed mid-session (Meta supports
    // external_id only at init, no reliable re-init). Dedup in the interim still
    // works via fbp/event_id; the external_id applies on the next page load.
    t.setPixelIdentity(null);
    t.trackEvent('AddToCart', { value: 5 });
    expect(fbq).toHaveBeenCalledWith('track', 'AddToCart', { value: 5 }, expect.anything());
  });

  it('flushQueue holds events when a single provider is enabled but not ready (B4 fix)', async () => {
    const t = await freshTracking();
    (window as any).fbq = undefined; // Meta tag not loaded yet
    t.setPixelIds('META', ''); // single provider
    t.trackEvent('ViewContent', { value: 1 }); // buffered (fbq undefined / not inited)
    t.trackEvent('AddToCart', { value: 2 });

    const fbq = ((window as any).fbq = vi.fn()); // tag loads
    t.setPixelIdentity(null);
    t.initMetaPixel(); // init + flush

    // Without the B4 fix the setPixelIds flush (fbq undefined, single provider)
    // would have drained and dropped these; with it they are held and flushed.
    expect(fbq).toHaveBeenCalledWith('track', 'ViewContent', { value: 1 }, expect.anything());
    expect(fbq).toHaveBeenCalledWith('track', 'AddToCart', { value: 2 }, expect.anything());
  });

  it('Wave-2.3: setPixelIdentity with em/ph emits external_id + em + ph at init (Advanced Matching)', async () => {
    const t = await freshTracking();
    const fbq = window.fbq as ReturnType<typeof vi.fn>;

    t.setPixelIdentity('ext-1', 'em-hash', 'ph-hash');
    t.setPixelIds('META', '');
    t.initMetaPixel();

    expect(fbq).toHaveBeenCalledWith('init', 'META', { external_id: 'ext-1', em: 'em-hash', ph: 'ph-hash' });
    expect(fbq).toHaveBeenCalledWith('track', 'PageView');
  });

  it('Wave-2.3: em/ph are optional — external_id alone keeps the legacy init shape', async () => {
    const t = await freshTracking();
    const fbq = window.fbq as ReturnType<typeof vi.fn>;

    t.setPixelIdentity('ext-1');
    t.setPixelIds('META', '');
    t.initMetaPixel();

    expect(fbq).toHaveBeenCalledWith('init', 'META', { external_id: 'ext-1' });
  });

  it('Wave-2.3: identity arriving after init is kept for the next load — no double init', async () => {
    const t = await freshTracking();
    const fbq = window.fbq as ReturnType<typeof vi.fn>;

    t.setPixelIds('META', '');
    t.initMetaPixel();
    const initCount = () => fbq.mock.calls.filter((c) => c[0] === 'init').length;
    expect(initCount()).toBe(1);

    t.setPixelIdentity('ext-2', 'em-2', 'ph-2');
    t.initMetaPixel();

    // Graceful extension: state updated, but the init never re-fires mid-session.
    expect(initCount()).toBe(1);
  });
});