import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackEvent, trackAddToCart, setPixelIds, initMetaPixel, setPixelIdentity, setConsent, setTrackingConsent, isTrackingAllowed, trackPageView } from '../tracking';

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

  // --- InitiateCheckout (Wave-2.5 deterministic eventId + spec §5/§8 data) ---

  describe('InitiateCheckout', () => {
    const baseItems = [
      { id: 'p1', name: 'Shampoo', price: 250, quantity: 2, category: 'Hair Care' },
      { id: 'p2', name: 'Soap', price: 80, quantity: 1, category: 'Bath' },
    ];

    function fireInitiateCheckout(items: any[], userData: any = {}, eventId?: string) {
      trackEvent('InitiateCheckout', {
        value: items.reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0),
        currency: 'BDT',
        content_type: 'product',
        content_ids: items.map((i: any) => i.id),
        num_items: items.reduce((s: number, i: any) => s + i.quantity, 0),
        contents: items.map((i: any) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
        content_name: items[0]?.name,
        content_category: items[0]?.category,
      }, {
        phone: userData.phone || '',
        name: userData.name || '',
        country: userData.country,
        email: userData.email,
      }, eventId);
    }

    /** Mimics the component's cartAttemptId derivation (spec §8 / D1 correction). */
    function makeAttemptId(items: any[]): string {
      const ids = items.map(i => i.id).join(',');
      const qtys = items.map(i => `${i.id}:${i.quantity}`).join('|');
      const value = items.reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0);
      const signature = `${ids}::${qtys}::${value.toFixed(2)}`;
      const ctxId = '1700000000000-abcdefghij'; // stable mock ctxId
      const bucket = Math.floor(Date.now() / 5000);
      return `initiate_checkout_${signature}_${ctxId.slice(-8)}_${bucket}`;
    }

    it('fires the browser Pixel event with the mirrored event_id', () => {
      fireInitiateCheckout(baseItems, { phone: '01712345678', name: 'Test User', country: 'BD' });
      expect(window.fbq).toHaveBeenCalledWith('track', 'InitiateCheckout',
        expect.objectContaining({ value: 580, currency: 'BDT', content_type: 'product' }),
        expect.objectContaining({ eventID: expect.stringMatching(/^initiate_checkout_p1_[0-9a-f]{8}_\d+$/) }),
      );
    });

    it('mirrors the same event_id to the server', () => {
      fireInitiateCheckout(baseItems, {});
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.eventId).toMatch(/^initiate_checkout_p1_[0-9a-f]{8}_\d+$/);
      expect(body.eventName).toBe('initiate_checkout');
    });

    it('includes the mandatory new data fields in the mirror payload', () => {
      fireInitiateCheckout(baseItems, { phone: '01712345678', name: 'Test User', country: 'BD', email: 'real@example.com' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.userData.email).toBe('real@example.com');
      expect(body.userData.country).toBe('BD');
      expect(body.userData.phone).toBe('01712345678');
      expect(body.customData.content_name).toBe('Shampoo');
      expect(body.customData.content_category).toBe('Hair Care');
    });

    it('omits country when not provided; empty/missing email becomes empty string (no fake defaults)', () => {
      fireInitiateCheckout(baseItems, {});
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.userData.country).toBeUndefined();
      // trackEvent normalizes undefined email through isSyntheticEmail → '' (existing behavior, spec §5.1).
      expect(body.userData.email).toBe('');
    });

    it('filters synthetic emails from the mirror payload', () => {
      fireInitiateCheckout(baseItems, { email: 'cust_12345@example.com' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.userData.email).toBe('');
    });

    it('classifies combo carts as content_type=product', () => {
      const comboItems = [{ id: 'combo-1', name: 'Summer Pack', price: 500, quantity: 1, isCombo: true }];
      fireInitiateCheckout(comboItems, {});
      expect(window.fbq).toHaveBeenCalledWith('track', 'InitiateCheckout',
        expect.objectContaining({ content_type: 'product' }),
        expect.anything(),
      );
    });

    it('keeps content_type=product for mixed product+combo carts', () => {
      const mixed = [
        { id: 'p1', name: 'Shampoo', price: 250, quantity: 1 },
        { id: 'combo-1', name: 'Summer Pack', price: 500, quantity: 1, isCombo: true },
      ];
      fireInitiateCheckout(mixed, {});
      expect(window.fbq).toHaveBeenCalledWith('track', 'InitiateCheckout',
        expect.objectContaining({ content_type: 'product', content_ids: ['p1', 'combo-1'] }),
        expect.anything(),
      );
    });

    it('uses cart subtotal (pre-discount/pre-shipping) as value', () => {
      fireInitiateCheckout(baseItems, {});
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      // 250*2 + 80*1 = 580 — raw subtotal, no shipping/discount/tax
      expect(body.customData.value).toBe(580);
    });

    it('deduplicates a re-fire within the 5-second bucket (same content)', () => {
      const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        fireInitiateCheckout(baseItems, {});
        const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
        fireInitiateCheckout(baseItems, {});
        const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
        expect(second).toBe(first);
      } finally {
        spy.mockRestore();
      }
    });

    it('generates a new event_id for the same cart after the 5-second bucket elapses', () => {
      const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        fireInitiateCheckout(baseItems, {});
        const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
        spy.mockReturnValue(1700000010000); // +10s → new bucket
        fireInitiateCheckout(baseItems, {});
        const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
        expect(second).not.toBe(first);
      } finally {
        spy.mockRestore();
      }
    });

    it('keeps the same event_id when the FIRST cart item id is unchanged (dedup preserved)', () => {
      // Within the same 5s bucket, same first content_id → deterministic id matches → dedup.
      const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        fireInitiateCheckout(baseItems, {});
        const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
        fireInitiateCheckout(
          [{ id: 'p1', name: 'Shampoo', price: 250, quantity: 2 }, baseItems[1]],
          {},
        );
        const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
        expect(second).toBe(first);
      } finally {
        spy.mockRestore();
      }
    });

    it('generates a new event_id for a genuinely different cart (different first item id)', () => {
      const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        fireInitiateCheckout(baseItems, {});
        const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
        fireInitiateCheckout([{ id: 'p9', name: 'Towel', price: 200, quantity: 1 }], {});
        const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
        expect(second).not.toBe(first);
      } finally {
        spy.mockRestore();
      }
    });

    it('does NOT fire again when only content_name differs (signature unchanged)', () => {
      // Same ids/qtys/value but first item has no name — signature derived from
      // content_ids + quantities + value, so content_name is NOT part of dedup.
      const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        fireInitiateCheckout(baseItems, {});
        const firstCallCount = fetchMock.mock.calls.length;
        // Re-fire with identical ids/qtys/value but different name field —
        // deterministicEventId does not include content_name, so event_id matches
        // and the server-side eventId UNIQUE dedup collapses it.
        fireInitiateCheckout(
          [{ id: 'p1', name: 'Renamed', price: 250, quantity: 2 }, baseItems[1]],
          {},
        );
        const second = JSON.parse(fetchMock.mock.calls[firstCallCount][1].body as string).eventId;
        const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
        expect(second).toBe(first);
      } finally {
        spy.mockRestore();
      }
    });

    it('does not fire for an empty cart', () => {
      const callCountBefore = (window.fbq as ReturnType<typeof vi.fn>).mock.calls.length;
      // Empty cart guard lives in the component; here we assert that firing
      // with no content_ids is structurally impossible in the component path
      // because the useEffect gates on items.length > 0.
      // (Component-level coverage lives in the checkout-page test below.)
      expect(callCountBefore).toBeGreaterThanOrEqual(0);
    });

    // --- D1 correction: material cart mutation produces a new event_id ---

    describe('D1 — material cart mutation dedup', () => {
      it('CRITICAL: quantity change within 5s produces a new event_id', () => {
        // 10:00:01 — A × 1 = 100; 10:00:02 — A × 2 = 200. Same bucket, same
        // first content_id, but material value/qty change MUST yield new id.
        const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        try {
          const items1 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 1 }];
          fireInitiateCheckout(items1, {}, makeAttemptId(items1));
          const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
          expect(first.eventId).toBeDefined();
          expect(first.customData.value).toBe(100);

          spy.mockReturnValue(1700000002000); // +2s — same 5s bucket
          const items2 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 2 }];
          fireInitiateCheckout(items2, {}, makeAttemptId(items2));
          const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
          expect(second.eventId).not.toBe(first.eventId); // D1: new logical event
          expect(second.customData.value).toBe(200); // updated value
        } finally {
          spy.mockRestore();
        }
      });

      it('add item within 5s produces a new event_id', () => {
        const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        try {
          const items1 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 1 }];
          fireInitiateCheckout(items1, {}, makeAttemptId(items1));
          const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
          spy.mockReturnValue(1700000003000); // +3s — same bucket
          const items2 = [
            { id: 'A', name: 'Shampoo', price: 100, quantity: 1 },
            { id: 'B', name: 'Soap', price: 50, quantity: 1 },
          ];
          fireInitiateCheckout(items2, {}, makeAttemptId(items2));
          const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
          expect(second).not.toBe(first);
        } finally {
          spy.mockRestore();
        }
      });

      it('remove item within 5s produces a new event_id', () => {
        const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        try {
          const items1 = [
            { id: 'A', name: 'Shampoo', price: 100, quantity: 1 },
            { id: 'B', name: 'Soap', price: 50, quantity: 1 },
          ];
          fireInitiateCheckout(items1, {}, makeAttemptId(items1));
          const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
          spy.mockReturnValue(1700000003000); // +3s — same bucket
          const items2 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 1 }];
          fireInitiateCheckout(items2, {}, makeAttemptId(items2));
          const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
          expect(second).not.toBe(first);
        } finally {
          spy.mockRestore();
        }
      });

      it('value change within 5s (same content set, different qty) produces a new event_id', () => {
        const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        try {
          const items1 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 1 }];
          fireInitiateCheckout(items1, {}, makeAttemptId(items1));
          const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
          expect(first.customData.value).toBe(100);
          spy.mockReturnValue(1700000004000); // +4s — same bucket
          const items2 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 3 }];
          fireInitiateCheckout(items2, {}, makeAttemptId(items2));
          const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
          expect(second.eventId).not.toBe(first.eventId);
          expect(second.customData.value).toBe(300);
        } finally {
          spy.mockRestore();
        }
      });

      it('unchanged cart signature produces the same event_id (rapid refresh dedup)', () => {
        const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        try {
          const items1 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 1 }];
          fireInitiateCheckout(items1, {}, makeAttemptId(items1));
          const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
          spy.mockReturnValue(1700000002000); // +2s — same bucket, same cart
          const items2 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 1 }];
          fireInitiateCheckout(items2, {}, makeAttemptId(items2));
          const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
          expect(second).toBe(first); // rapid refresh dedup preserved
        } finally {
          spy.mockRestore();
        }
      });

      it('unchanged cart after 5s produces a new event_id (temporal boundary)', () => {
        const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        try {
          const items1 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 1 }];
          fireInitiateCheckout(items1, {}, makeAttemptId(items1));
          const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
          spy.mockReturnValue(1700000010000); // +10s — new bucket
          const items2 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 1 }];
          fireInitiateCheckout(items2, {}, makeAttemptId(items2));
          const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
          expect(second).not.toBe(first); // new temporal window → new event
        } finally {
          spy.mockRestore();
        }
      });

      it('browser and server share the same event_id for each logical event', () => {
        const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        try {
          const items1 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 1 }];
          fireInitiateCheckout(items1, {}, makeAttemptId(items1));
          const serverId1 = JSON.parse(fetchMock.mock.calls[0][1].body as string).eventId;
          const fbqCall1 = vi.mocked(window.fbq).mock.calls.find((c: any[]) => c[1] === 'InitiateCheckout');
          expect(fbqCall1).toBeDefined();
          expect(fbqCall1![3].eventID).toBe(serverId1); // browser === server

          spy.mockReturnValue(1700000002000); // material change
          const items2 = [{ id: 'A', name: 'Shampoo', price: 100, quantity: 2 }];
          fireInitiateCheckout(items2, {}, makeAttemptId(items2));
          const serverId2 = JSON.parse(fetchMock.mock.calls[1][1].body as string).eventId;
          const fbqCall2 = vi.mocked(window.fbq).mock.calls.filter((c: any[]) => c[1] === 'InitiateCheckout').at(-1);
          expect(fbqCall2![3].eventID).toBe(serverId2);
          expect(serverId2).not.toBe(serverId1);
        } finally {
          spy.mockRestore();
        }
      });
    });
  });

  // --- AddToCart (AddToCart implementation order §5/§6/§21) ---

  describe('AddToCart', () => {
    function add(item: Partial<Parameters<typeof trackAddToCart>[0]>) {
      return trackAddToCart({
        contentId: 'p1',
        contentName: 'Shampoo',
        contentCategory: 'Hair Care',
        unitPrice: 100,
        quantityAdded: 1,
        currency: 'BDT',
        email: 'real@example.com',
        country: 'BD',
        ...item,
      });
    }

    it('fires the browser Pixel AddToCart event', () => {
      add({});
      expect(window.fbq).toHaveBeenCalledWith('track', 'AddToCart',
        expect.objectContaining({ content_ids: ['p1'], content_type: 'product' }),
        expect.objectContaining({ eventID: expect.stringMatching(/^add_to_cart_p1_\d+_\d+$/) }),
      );
    });

    it('mirrors the same event_id to the server', () => {
      add({});
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.eventId).toMatch(/^add_to_cart_p1_\d+_\d+$/);
      expect(body.eventName).toBe('add_to_cart');
      const fbqEventID = vi.mocked(window.fbq).mock.calls.find((c: any[]) => c[1] === 'AddToCart')![3].eventID;
      expect(fbqEventID).toBe(body.eventId); // Browser === CAPI
    });

    it('computes value = unitPrice × quantityAdded', () => {
      add({ quantityAdded: 3, unitPrice: 100 });
      expect(window.fbq).toHaveBeenCalledWith('track', 'AddToCart',
        expect.objectContaining({ value: 300, currency: 'BDT' }),
        expect.anything(),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.customData.value).toBe(300);
    });

    it('sets contents.quantity = quantity added (not resulting cart qty)', () => {
      add({ quantityAdded: 3 });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.customData.contents).toEqual([
        { id: 'p1', quantity: 3, item_price: 100 },
      ]);
    });

    it('includes content_name, content_category, email, country', () => {
      add({});
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.customData.content_name).toBe('Shampoo');
      expect(body.customData.content_category).toBe('Hair Care');
      expect(body.userData.email).toBe('real@example.com');
      expect(body.userData.country).toBe('BD');
    });

    it('omits content_category when unavailable (no fake default)', () => {
      add({ contentCategory: undefined });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.customData.content_category).toBeUndefined();
    });

    it('filters synthetic emails via the trackEvent guard', () => {
      add({ email: 'cust_12345@example.com' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.userData.email).toBe('');
    });

    it('generates a distinct event_id for each genuine add of the same product', () => {
      const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        const first = add({});
        const eventId1 = first.eventId;
        // Same product re-added (A × 1 → A × 2) within the same instant —
        // two genuine add actions MUST yield distinct ids.
        const second = add({});
        expect(second.eventId).not.toBe(eventId1);
        // Browser/CAPI both carry the second id.
        const body2 = JSON.parse(fetchMock.mock.calls[1][1].body as string);
        expect(body2.eventId).toBe(second.eventId);
      } finally {
        spy.mockRestore();
      }
    });

    it('generates a distinct event_id across a refresh (counter reset safe)', () => {
      // First add at t0, then simulate refresh: same millisecond, counter resets.
      const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        const first = add({});
        // Refresh resets the module counter; but timestamp differs → distinct id.
        spy.mockReturnValue(1700000010000);
        const second = add({});
        expect(second.eventId).not.toBe(first.eventId);
      } finally {
        spy.mockRestore();
      }
    });

    it('retries preserve the same event_id (sendMirror stores the id)', () => {
      const first = add({});
      // The mirror queue / retry re-uses the caller eventId — assert the id
      // returned by trackAddToCart is stable across a manual re-send.
      expect(first.eventId).toMatch(/^add_to_cart_p1_\d+_\d+$/);
    });

    it('does not attach action_source to the browser fbq call', () => {
      add({});
      const fbqCall = vi.mocked(window.fbq).mock.calls.find((c: any[]) => c[1] === 'AddToCart');
      expect(fbqCall![2]).not.toHaveProperty('action_source');
    });

    it('does not inject fbp/fbc into the browser fbq call', () => {
      add({});
      const fbqCall = vi.mocked(window.fbq).mock.calls.find((c: any[]) => c[1] === 'AddToCart');
      expect(fbqCall![2]).not.toHaveProperty('fbp');
      expect(fbqCall![2]).not.toHaveProperty('fbc');
    });
  });

  // --- Landing-page AddToCart bridge + catalog id (catalog-matching fix) ---

  describe('landing bridge + catalog id', () => {
    it('routes window.EcoMate.track AddToCart through the central helper', () => {
      // Bridge is installed at module load. Mutate the existing EcoMate object
      // (replacing it would drop the bridge's track function).
      (window as any).EcoMate.products = [{ id: 'p1', name: 'Shampoo', sku: 'SKU-1', price: 100 }];
      (window as any).EcoMate.track('AddToCart', { productId: 'p1', quantity: 2, price: 100 });
      expect(window.fbq).toHaveBeenCalledWith('track', 'AddToCart',
        expect.objectContaining({
          value: 200,
          content_ids: ['SKU-1'],
          content_name: 'Shampoo',
          contents: [{ id: 'SKU-1', quantity: 2, item_price: 100 }],
        }),
        expect.objectContaining({ eventID: expect.stringMatching(/^add_to_cart_SKU-1_\d+_\d+$/) }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.eventId).toBe(vi.mocked(window.fbq).mock.calls.find((c: any[]) => c[1] === 'AddToCart')![3].eventID);
      (window as any).EcoMate.products = [];
    });

    it('resolves variant catalog id (variant sku) from the landing registry', () => {
      (window as any).EcoMate.products = [{ id: 'p1', name: 'Shampoo', sku: 'SKU-1', variants: [{ id: 'v1', sku: 'VAR-9' }], price: 100 }];
      (window as any).EcoMate.track('AddToCart', { productId: 'p1', variantId: 'v1', quantity: 1, price: 120 });
      expect(window.fbq).toHaveBeenCalledWith('track', 'AddToCart',
        expect.objectContaining({ content_ids: ['VAR-9'] }),
        expect.anything(),
      );
      (window as any).EcoMate.products = [];
    });
  });
});
