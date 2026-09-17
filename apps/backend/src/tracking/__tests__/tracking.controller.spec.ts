import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { TrackingController } from '../tracking.controller';
import { TrackingCaptureService } from '../tracking-capture.service';
import { TrackingSettingsService } from '../tracking-settings.service';

describe('TrackingController', () => {
  const allPublicMethods = ['trackEvent', 'saveContext', 'trackPageView', 'trackingConfig'];
  let trackingCapture: { capture: jest.Mock };
  let trackingContext: { upsertContext: jest.Mock; getByCtxId: jest.Mock };
  let pageViewBuffer: { push: jest.Mock };
  let trackingSettings: {
    buildConfigSnapshot: jest.Mock;
    isEnabledOrDefault: jest.Mock;
  };
  let identityResolution: {
    resolveForShopper: jest.Mock;
    resolveAdvancedMatching: jest.Mock;
    resolveFbLoginIdForShopper: jest.Mock;
    isEnabled: jest.Mock;
  };
  let controller: TrackingController;

  beforeEach(() => {
    trackingCapture = { capture: jest.fn() };
    trackingContext = { upsertContext: jest.fn(), getByCtxId: jest.fn().mockResolvedValue(null) };
    pageViewBuffer = { push: jest.fn() };
    trackingSettings = {
      buildConfigSnapshot: jest.fn().mockResolvedValue({
        enabledProviders: ['meta'],
        normalizerVersion: 1,
      }),
      isEnabledOrDefault: jest.fn().mockResolvedValue(false),
    };
    identityResolution = {
      resolveForShopper: jest.fn(),
      resolveAdvancedMatching: jest.fn().mockResolvedValue({}),
      resolveFbLoginIdForShopper: jest.fn().mockResolvedValue(null),
      resolveRawCustomerProfile: jest.fn().mockResolvedValue(null),
      isEnabled: jest.fn().mockResolvedValue(false),
    };
    controller = new TrackingController(
      trackingCapture as unknown as TrackingCaptureService,
      trackingContext as never,
      pageViewBuffer as never,
      trackingSettings as unknown as TrackingSettingsService,
      identityResolution as never,
    );
  });

  it('has no RequiresFeature metadata on any method', () => {
    for (const method of allPublicMethods) {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        TrackingController.prototype[method],
      );
      expect(meta).toBeUndefined();
    }
  });

  describe('POST /tracking/events', () => {
    const req = {
      ip: '203.0.113.7',
      headers: { 'user-agent': 'storefront-ua' },
    } as never;

    it('captures a canonical snapshot + outbox via TrackingCaptureService', async () => {
      const body = {
        eventId: 'evt-123',
        eventName: 'purchase',
        ctxId: 'ctx-abc',
        customData: {
          value: 1250,
          currency: 'BDT',
          content_ids: ['p1', 'p2'],
          contents: [
            { id: 'p1', quantity: 1, item_price: 600 },
            { id: 'p2', quantity: 1, item_price: 650 },
          ],
          num_items: 2,
          search_string: 'eco',
          order_id: 'ord-42',
        },
        userData: {
          email: 'buyer@example.com',
          phone: '+8801711111111',
          name: 'Jane Doe',
          city: 'Dhaka',
          country: 'BD',
          fbp: 'fb.1.111',
          fbc: 'fb.1.222',
          url: 'https://ecoshop.example/p',
          referrer: 'https://www.facebook.com/',
          // Wave-3 — FB-logged-in shoppers carry the Facebook user id on the mirror
          fbLoginId: 'fb-user-987654',
        },
      };

      const result = await controller.trackEvent(body, req);

      expect(trackingCapture.capture).toHaveBeenCalledTimes(1);
      const input = trackingCapture.capture.mock.calls[0][0];
      expect(input.eventId).toBe('evt-123');
      expect(input.eventType).toBe('Purchase');
      expect(input.ctxId).toBe('ctx-abc');
      expect(input.orderId).toBe('ord-42'); // Purchase mirrors carry the canonical displayId
      expect(input.actionSource).toBe('website');
      expect(typeof input.eventTime).toBe('number');
      expect(input.payload).toMatchObject({
        triggerMode: 'browser',
        value: 1250,
        currency: 'BDT',
        content_ids: ['p1', 'p2'],
        num_items: 2,
        search_string: 'eco',
        orderId: 'ord-42',
        customer: {
          email: 'buyer@example.com',
          phone: '+8801711111111',
          firstName: 'Jane Doe',
          city: 'Dhaka',
          country: 'BD',
          fbLoginId: 'fb-user-987654',
        },
      });
      expect(input.payload.contents).toEqual([
        { id: 'p1', quantity: 1, item_price: 600 },
        { id: 'p2', quantity: 1, item_price: 650 },
      ]);
      expect(input.configSnapshot).toMatchObject({
        source: 'browser',
        ip: '203.0.113.7',
        userAgent: 'storefront-ua',
      });
      expect(typeof input.configSnapshot.capturedAt).toBe('string');
      // Capture-time settings populate the dispatcher's work set; without this the
      // browser event would be captured with zero eligible providers and never dispatch.
      expect(input.configSnapshot.enabledProviders).toEqual(['meta']);
      expect(input.configSnapshot.normalizerVersion).toBe(1);
      expect(trackingCapture.capture.mock.calls[0][1]).toBeUndefined();
      expect(result).toEqual({ success: true });
    });

    it('maps snake_case event names to canonical TrackingEventType', async () => {
      const cases: Array<[string, string]> = [
        ['view_content', 'ViewContent'],
        ['add_to_cart', 'AddToCart'],
        ['add_to_wishlist', 'AddToWishlist'],
        ['initiate_checkout', 'InitiateCheckout'],
        ['add_payment_info', 'AddPaymentInfo'],
        ['search', 'Search'],
        ['complete_registration', 'CompleteRegistration'],
        ['lead', 'Lead'],
      ];
      for (const [snake, canonical] of cases) {
        await controller.trackEvent(
          { eventId: `e-${snake}`, eventName: snake },
          req,
        );
        expect(trackingCapture.capture).toHaveBeenLastCalledWith(
          expect.objectContaining({ eventType: canonical }),
          undefined,
        );
      }
    });

    it('captures page_view for server-side CAPI (redundant setup, deduped by event_id)', async () => {
      trackingCapture.capture.mockClear();
      const result = await controller.trackEvent(
        { eventId: 'page_view_abc123', eventName: 'page_view', ctxId: 'ctx-1' },
        req,
      );
      expect(trackingCapture.capture).toHaveBeenCalledTimes(1);
      const input = trackingCapture.capture.mock.calls[0][0];
      expect(input.eventType).toBe('PageView');
      // Same event_id the browser Pixel fired → Meta dedups the pair.
      expect(input.eventId).toBe('page_view_abc123');
      expect(result).toEqual({ success: true });
    });

    it('enriches a logged-in mirror with profile contact the caller did not supply', async () => {
      trackingCapture.capture.mockClear();
      identityResolution.resolveRawCustomerProfile.mockResolvedValue({
        email: 'profile@example.com',
        phone: '+8801711111111',
        name: 'Profile User',
      });
      const user = { betterAuthSession: { user: { id: 'ba-9' } } };
      await controller.trackEvent(
        {
          eventId: 'e-enrich',
          eventName: 'view_content',
          ctxId: 'ctx-9',
          customData: { value: 10, currency: 'BDT' },
          userData: { country: 'BD' },
        },
        req,
        user,
      );
      const input = trackingCapture.capture.mock.calls[0][0];
      expect(
        identityResolution.resolveRawCustomerProfile,
      ).toHaveBeenCalledWith('ba-9');
      expect(input.payload.customer).toMatchObject({
        email: 'profile@example.com',
        phone: '+8801711111111',
        firstName: 'Profile User',
        country: 'BD',
      });
    });

    it('caller-supplied identity wins over profile enrichment (never overwrites)', async () => {
      trackingCapture.capture.mockClear();
      identityResolution.resolveRawCustomerProfile.mockResolvedValue({
        email: 'profile@example.com',
        phone: '+8801700000000',
        name: 'Profile User',
      });
      const user = { betterAuthUserId: 'ba-9' };
      await controller.trackEvent(
        {
          eventId: 'e-caller-wins',
          eventName: 'view_content',
          userData: { email: 'typed@example.com', country: 'BD' },
        },
        req,
        user,
      );
      const input = trackingCapture.capture.mock.calls[0][0];
      expect(input.payload.customer).toMatchObject({
        email: 'typed@example.com',
        phone: '+8801700000000',
      });
    });

    it('caller firstName wins; profile full name is the fallback (lastName stays caller-only)', async () => {
      trackingCapture.capture.mockClear();
      identityResolution.resolveRawCustomerProfile.mockResolvedValue({
        email: 'profile@example.com',
        phone: null,
        name: 'Profile Full Name',
      });
      const user = { betterAuthUserId: 'ba-9' };
      // Caller-typed firstName beats the stored full name; lastName has no
      // profile source by design (the adapter splits full firstName instead).
      await controller.trackEvent(
        {
          eventId: 'e-fn-chain',
          eventName: 'view_content',
          userData: { firstName: 'Typed', country: 'BD' },
        },
        req,
        user,
      );
      expect(
        trackingCapture.capture.mock.calls[0][0].payload.customer,
      ).toMatchObject({ firstName: 'Typed', email: 'profile@example.com' });

      trackingCapture.capture.mockClear();
      await controller.trackEvent(
        {
          eventId: 'e-fn-fallback',
          eventName: 'view_content',
          userData: { country: 'BD' },
        },
        req,
        user,
      );
      expect(
        trackingCapture.capture.mock.calls[0][0].payload.customer,
      ).toMatchObject({ firstName: 'Profile Full Name' });
    });

    it('legacy-JWT session user (no Better Auth session) still enriches via betterAuthUserId', async () => {
      trackingCapture.capture.mockClear();
      identityResolution.resolveRawCustomerProfile.mockResolvedValue({
        id: 'cust-7',
        email: 'jwt@example.com',
        phone: null,
        name: null,
      });
      // Guard legacy-JWT path: plain UserProfile with betterAuthUserId link.
      const user = { id: 'up-1', betterAuthUserId: 'ba-jwt' };
      await controller.trackEvent(
        { eventId: 'e-jwt', eventName: 'view_content', userData: { country: 'BD' } },
        req,
        user,
      );
      expect(
        identityResolution.resolveRawCustomerProfile,
      ).toHaveBeenCalledWith('ba-jwt');
      const input = trackingCapture.capture.mock.calls[0][0];
      expect(input.payload.customer.email).toBe('jwt@example.com');
      expect(input.payload.customerId).toBe('cust-7');
    });

    it('a client cannot select another customer: body carries no customer id', async () => {
      trackingCapture.capture.mockClear();
      await controller.trackEvent(
        {
          eventId: 'e-spoof',
          eventName: 'view_content',
          customData: { customerId: 'cust-victim', customer_id: 'cust-victim' },
          userData: { customerId: 'cust-victim', country: 'BD' },
        },
        req,
      );
      const input = trackingCapture.capture.mock.calls[0][0];
      // No session → no binding, regardless of what the client sent.
      expect(input.payload.customerId).toBeUndefined();
      expect(
        identityResolution.resolveRawCustomerProfile,
      ).not.toHaveBeenCalled();
    });

    it('guest mirrors skip enrichment entirely (absent stays absent)', async () => {
      trackingCapture.capture.mockClear();
      await controller.trackEvent(
        {
          eventId: 'e-guest',
          eventName: 'view_content',
          userData: { country: 'BD' },
        },
        req,
      );
      expect(
        identityResolution.resolveRawCustomerProfile,
      ).not.toHaveBeenCalled();
      const input = trackingCapture.capture.mock.calls[0][0];
      expect(input.payload.customer.email).toBeUndefined();
      expect(input.payload.customer.phone).toBeUndefined();
      expect(input.payload.customer.firstName).toBeUndefined();
    });

    it('returns success even when capture throws (best-effort, never 500s)', async () => {
      trackingCapture.capture.mockRejectedValueOnce(new Error('db down'));
      const result = await controller.trackEvent(
        { eventId: 'e-fail', eventName: 'lead' },
        req,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('GET /tracking/identity (Wave-2.1 shopper external_id)', () => {
    it('resolves the shopper external_id from the Better Auth session', async () => {
      identityResolution.resolveForShopper.mockResolvedValue('cust-ext-1');
      const user = { betterAuthSession: { user: { id: 'ba-1' } } };
      await expect(controller.identity(user)).resolves.toEqual({
        externalId: 'cust-ext-1',
      });
      expect(identityResolution.resolveForShopper).toHaveBeenCalledWith('ba-1');
    });

    it('falls back to user.betterAuthUserId when no session payload is present', async () => {
      identityResolution.resolveForShopper.mockResolvedValue('cust-ext-2');
      await expect(controller.identity({ betterAuthUserId: 'ba-2' })).resolves.toEqual({
        externalId: 'cust-ext-2',
      });
    });

    it('returns null externalId for unauthenticated requests', async () => {
      await expect(controller.identity({})).resolves.toEqual({ externalId: null });
      expect(identityResolution.resolveForShopper).not.toHaveBeenCalled();
    });

    it('spreads Advanced Matching hashes (em/ph) when enabled (Wave-2.3)', async () => {
      identityResolution.resolveForShopper.mockResolvedValue('cust-ext-3');
      identityResolution.resolveAdvancedMatching.mockResolvedValue({
        em: 'hash-em',
        ph: 'hash-ph',
      });
      const user = { betterAuthSession: { user: { id: 'ba-3' } } };
      await expect(controller.identity(user)).resolves.toEqual({
        externalId: 'cust-ext-3',
        em: 'hash-em',
        ph: 'hash-ph',
      });
      expect(identityResolution.resolveAdvancedMatching).toHaveBeenCalledWith('ba-3');
    });

    it('spreads fn/ln through to the browser Pixel init (EMQ name matching)', async () => {
      identityResolution.resolveForShopper.mockResolvedValue('cust-ext-5');
      identityResolution.resolveAdvancedMatching.mockResolvedValue({
        em: 'hash-em',
        fn: 'hash-fn',
        ln: 'hash-ln',
      });
      const user = { betterAuthSession: { user: { id: 'ba-5' } } };
      await expect(controller.identity(user)).resolves.toEqual({
        externalId: 'cust-ext-5',
        em: 'hash-em',
        fn: 'hash-fn',
        ln: 'hash-ln',
      });
    });

    it('includes fbLoginId when the shopper is linked to a facebook account (Wave-3)', async () => {
      identityResolution.resolveForShopper.mockResolvedValue('cust-ext-4');
      identityResolution.resolveFbLoginIdForShopper.mockResolvedValue('fb-user-4242');
      const user = { betterAuthSession: { user: { id: 'ba-4' } } };
      await expect(controller.identity(user)).resolves.toEqual({
        externalId: 'cust-ext-4',
        fbLoginId: 'fb-user-4242',
      });
      expect(identityResolution.resolveFbLoginIdForShopper).toHaveBeenCalledWith(
        'ba-4',
      );
    });

    it('omits fbLoginId for shoppers without a facebook account (never fabricated)', async () => {
      identityResolution.resolveForShopper.mockResolvedValue('cust-ext-5');
      identityResolution.resolveFbLoginIdForShopper.mockResolvedValue(null);
      const user = { betterAuthSession: { user: { id: 'ba-5' } } };
      const result = await controller.identity(user);
      expect(result).not.toHaveProperty('fbLoginId');
    });
  });

  describe('GET /tracking/config (Wave-2.3 public config)', () => {
    it('reports consent + advanced-matching + external-id capability from settings', async () => {
      trackingSettings.isEnabledOrDefault
        .mockResolvedValueOnce(true) // tracking_consent_required
        .mockResolvedValueOnce(true); // tracking_advanced_matching
      identityResolution.isEnabled.mockResolvedValue(true);
      await expect(controller.trackingConfig()).resolves.toEqual({
        consentRequired: true,
        advancedMatching: true,
        externalIdEnabled: true,
      });
    });

    it('defaults all flags to off when no settings/env are present', async () => {
      await expect(controller.trackingConfig()).resolves.toEqual({
        consentRequired: false,
        advancedMatching: false,
        externalIdEnabled: false,
      });
    });
  });

  describe('POST /tracking/events → mirror→context merge (Wave-2.2 C3/C6)', () => {
    const req = {
      ip: '203.0.113.7',
      headers: { 'user-agent': 'storefront-ua' },
    } as never;

    it('folds fbp/fbc from the mirror body into the journey context', async () => {
      const body = {
        eventId: 'evt-fbp',
        eventName: 'lead',
        ctxId: 'ctx-fbp',
        userData: { fbp: 'fb.1.999', fbc: 'fb.1.888' },
      };
      const result = await controller.trackEvent(body, req);
      expect(result).toEqual({ success: true });
      expect(trackingContext.upsertContext).toHaveBeenCalledWith(
        'ctx-fbp',
        {
          identifiers: {
            meta: { fbp: 'fb.1.999', fbc: 'fb.1.888' },
          },
        },
        '203.0.113.7',
        'storefront-ua',
      );
    });

    it('folds context on EVERY mirror event with ctxId — even without cookies (P1 fix: 2804050)', async () => {
      trackingContext.upsertContext.mockClear();
      await controller.trackEvent(
        { eventId: 'e-cookieless', eventName: 'lead', ctxId: 'ctx-none' },
        req,
      );
      expect(trackingContext.upsertContext).toHaveBeenCalledTimes(1);
      expect(trackingContext.upsertContext).toHaveBeenCalledWith(
        'ctx-none',
        {
          identifiers: { meta: { fbp: undefined } },
          url: undefined,
          referrer: undefined,
        },
        '203.0.113.7',
        'storefront-ua',
      );
    });

    it('skips the context merge only when there is no ctxId', async () => {
      trackingContext.upsertContext.mockClear();
      await controller.trackEvent(
        { eventId: 'e-y', eventName: 'lead' },
        req,
      );
      expect(trackingContext.upsertContext).not.toHaveBeenCalled();
    });

    it('synthesizes fbc with MILLISECONDS when no cookie/context value exists (Meta creationTime)', async () => {
      trackingContext.upsertContext.mockClear();
      jest.useFakeTimers().setSystemTime(new Date('2026-08-10T12:00:00Z'));
      await controller.trackEvent(
        {
          eventId: 'e-fbclid',
          eventName: 'lead',
          ctxId: 'ctx-clid',
          userData: { fbclid: 'AeBNw3Q8hVKzX2yU' },
        },
        req,
      );
      // 13-digit milliseconds — never 10-digit seconds.
      const nowMs = new Date('2026-08-10T12:00:00Z').getTime();
      expect(String(nowMs)).toHaveLength(13);
      expect(trackingContext.upsertContext).toHaveBeenCalledWith(
        'ctx-clid',
        expect.objectContaining({
          identifiers: {
            meta: { fbp: undefined, fbc: `fb.1.${nowMs}.AeBNw3Q8hVKzX2yU` },
          },
        }),
        '203.0.113.7',
        'storefront-ua',
      );
      jest.useRealTimers();
    });

    it('keeps an existing browser _fbc verbatim even when fbclid differs', async () => {
      trackingContext.upsertContext.mockClear();
      trackingContext.getByCtxId.mockResolvedValueOnce(null);
      await controller.trackEvent(
        {
          eventId: 'e-fbc-keep',
          eventName: 'lead',
          ctxId: 'ctx-keep',
          userData: { fbc: 'fb.1.1111111111111.OLDCLID', fbclid: 'NEWCLID' },
        },
        req,
      );
      expect(trackingContext.upsertContext).toHaveBeenCalledWith(
        'ctx-keep',
        expect.objectContaining({
          identifiers: { meta: expect.objectContaining({ fbc: 'fb.1.1111111111111.OLDCLID' }) },
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('prefers the stored context fbc over synthesizing from a later fbclid', async () => {
      trackingContext.upsertContext.mockClear();
      trackingContext.getByCtxId.mockResolvedValueOnce({
        identifiers: { meta: { fbc: { value: 'fb.1.2222222222222.FIRSTCLID' } } },
      });
      await controller.trackEvent(
        {
          eventId: 'e-fbc-stored',
          eventName: 'lead',
          ctxId: 'ctx-stored',
          userData: { fbclid: 'SECONDCLID' },
        },
        req,
      );
      expect(trackingContext.upsertContext).toHaveBeenCalledWith(
        'ctx-stored',
        expect.objectContaining({
          identifiers: { meta: expect.objectContaining({ fbc: 'fb.1.2222222222222.FIRSTCLID' }) },
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('stores no fbc at all when neither cookie nor fbclid exists (never fabricated)', async () => {
      trackingContext.upsertContext.mockClear();
      await controller.trackEvent(
        { eventId: 'e-nofbc', eventName: 'lead', ctxId: 'ctx-none', userData: {} },
        req,
      );
      expect(trackingContext.upsertContext).toHaveBeenCalledWith(
        'ctx-none',
        expect.objectContaining({ identifiers: { meta: { fbp: undefined } } }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('folds url/referrer from the mirror userData into the context', async () => {
      trackingContext.upsertContext.mockClear();
      await controller.trackEvent(
        {
          eventId: 'e-url',
          eventName: 'lead',
          ctxId: 'ctx-url',
          userData: {
            url: 'https://ecomate.example/p/1',
            referrer: 'https://facebook.com/',
          },
        },
        req,
      );
      expect(trackingContext.upsertContext).toHaveBeenCalledWith(
        'ctx-url',
        {
          identifiers: { meta: { fbp: undefined } },
          url: 'https://ecomate.example/p/1',
          referrer: 'https://facebook.com/',
        },
        '203.0.113.7',
        'storefront-ua',
      );
    });

    it('skips capture when the opt-out cookie is present (server-side guard)', async () => {
      trackingCapture.capture.mockClear();
      trackingContext.upsertContext.mockClear();
      await controller.trackEvent(
        { eventId: 'e-optout', eventName: 'purchase', ctxId: 'ctx-out' },
        { ...req, cookies: { ecomate_tracking_optout: '1' } } as never,
      );
      expect(trackingCapture.capture).not.toHaveBeenCalled();
      expect(trackingContext.upsertContext).not.toHaveBeenCalled();
    });
  });

  describe('POST /tracking/page-view (privacy P0 sanitization)', () => {
    const req = {
      ip: '203.0.113.7',
      headers: { 'user-agent': 'storefront-ua' },
    } as never;

    it('strips sensitive query params from url/referrer before buffering', async () => {
      await controller.trackPageView(
        {
          url: 'https://ecomate.example/checkout/thank-you?orderId=uuid-1&t=viewtoken',
          referrer: 'https://facebook.com/post?token=fb-secret',
        },
        '203.0.113.7',
        req,
      );
      expect(pageViewBuffer.push).toHaveBeenCalledTimes(1);
      const entry = pageViewBuffer.push.mock.calls[0][0];
      expect(entry.url).toBe('https://ecomate.example/checkout/thank-you');
      expect(entry.referrer).toBe('https://facebook.com/post');
      expect(JSON.stringify(entry)).not.toContain('viewtoken');
      expect(JSON.stringify(entry)).not.toContain('fb-secret');
    });

    it('keeps clean urls unchanged and null referrer null', async () => {
      await controller.trackPageView(
        { url: 'https://ecomate.example/products/abc' },
        '203.0.113.7',
        req,
      );
      const entry = pageViewBuffer.push.mock.calls[0][0];
      expect(entry.url).toBe('https://ecomate.example/products/abc');
      expect(entry.referrer).toBeNull();
    });
  });
});
