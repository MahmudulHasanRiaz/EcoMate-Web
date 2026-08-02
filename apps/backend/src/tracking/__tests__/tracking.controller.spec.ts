import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { TrackingController } from '../tracking.controller';
import { TrackingCaptureService } from '../tracking-capture.service';
import { TrackingSettingsService } from '../tracking-settings.service';

describe('TrackingController', () => {
  const allPublicMethods = ['trackEvent', 'saveContext'];
  let trackingCapture: { capture: jest.Mock };
  let trackingContext: { upsertContext: jest.Mock };
  let pageViewBuffer: { push: jest.Mock };
  let trackingSettings: { buildConfigSnapshot: jest.Mock };
  let controller: TrackingController;

  beforeEach(() => {
    trackingCapture = { capture: jest.fn() };
    trackingContext = { upsertContext: jest.fn() };
    pageViewBuffer = { push: jest.fn() };
    trackingSettings = {
      buildConfigSnapshot: jest.fn().mockResolvedValue({
        enabledProviders: ['meta'],
        normalizerVersion: 1,
      }),
    };
    controller = new TrackingController(
      trackingCapture as unknown as TrackingCaptureService,
      trackingContext as never,
      pageViewBuffer as never,
      trackingSettings as unknown as TrackingSettingsService,
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
        },
      };

      const result = await controller.trackEvent(body, req);

      expect(trackingCapture.capture).toHaveBeenCalledTimes(1);
      const input = trackingCapture.capture.mock.calls[0][0];
      expect(input.eventId).toBe('evt-123');
      expect(input.eventType).toBe('Purchase');
      expect(input.ctxId).toBe('ctx-abc');
      expect(input.orderId).toBeUndefined();
      expect(input.actionSource).toBe('website');
      expect(typeof input.eventTime).toBe('number');
      expect(input.payload).toMatchObject({
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

    it('skips page_view (excluded from CAPI) without capturing', async () => {
      trackingCapture.capture.mockClear();
      const result = await controller.trackEvent(
        { eventId: 'e-pv', eventName: 'page_view' },
        req,
      );
      expect(trackingCapture.capture).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
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
});
