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
      eventID: expect.stringMatching(/^\d+-[a-z0-9]{8}$/),
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
});