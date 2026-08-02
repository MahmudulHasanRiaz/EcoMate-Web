import { Ga4Adapter } from '../adapters/ga4.adapter';
import { ProviderPayload } from '../adapters/tracking-provider.adapter';
import { TrackingNormalizer } from '../tracking.normalizer';
import {
  TrackingContextView,
  TrackingSnapshotPayload,
} from '../tracking-snapshot.types';

const normalizer = new TrackingNormalizer();

const snapshot: TrackingSnapshotPayload = {
  eventType: 'Purchase',
  orderId: 'ord-1001',
  value: 2500,
  currency: 'BDT',
  content_ids: ['sku-1', 'sku-2'],
  contents: [
    { id: 'sku-1', quantity: 2, item_price: 1000 },
    { id: 'sku-2', quantity: 1, item_price: 500 },
  ],
  num_items: 3,
  search_string: 'organic rice',
  customer: {
    email: 'John.Doe@Example.com',
    phone: '01712345678',
    firstName: 'John',
    lastName: 'Doe',
    city: 'Dhaka',
    state: 'Dhaka',
    country: 'BD',
    zip: '1212',
  },
};

const ctx: TrackingContextView = {
  externalId: 'CUST-42',
  gaClientId: 'GA1.2.9876543210.1234567890',
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (test)',
  url: 'https://ecomate.example/checkout',
  referrer: 'https://ecomate.example/product/sku-1',
};

const mockResponse = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

const wirePayload = (over: Partial<ProviderPayload> = {}): ProviderPayload => ({
  eventName: 'purchase',
  eventId: 'purchase_ord-1001',
  eventTime: 1722600000,
  eventType: 'Purchase',
  client_id: 'GA1.2.9876543210.1234567890',
  events: [
    {
      name: 'purchase',
      params: {
        value: 2500,
        currency: 'BDT',
        transaction_id: 'ord-1001',
        timestamp_micros: 1722600000000,
      },
    },
  ],
  ...over,
});

describe('Ga4Adapter (design §4.6 — GA4 Measurement Protocol provider adapter)', () => {
  const adapter = new Ga4Adapter();

  describe('provider metadata', () => {
    it('declares provider, version, and API version', () => {
      expect(adapter.provider).toBe('ga4');
      expect(adapter.version).toBe(1);
      expect(adapter.providerApiVersion).toBe('mp/collect');
    });
  });

  describe('dispatch policy (design §4.6 — GA4 suppresses browser-fired instant events)', () => {
    it('returns false in instant mode for events the browser fires via gtag', () => {
      for (const eventType of [
        'Purchase',
        'ViewContent',
        'AddToCart',
        'InitiateCheckout',
        'AddPaymentInfo',
        'Search',
        'CompleteRegistration',
      ]) {
        expect(adapter.supports(eventType)).toBe(false);
      }
    });

    it('returns true with serverOnly for validated/offline events', () => {
      for (const eventType of [
        'Purchase',
        'ViewContent',
        'AddToCart',
        'InitiateCheckout',
        'AddPaymentInfo',
        'Search',
        'CompleteRegistration',
        'Refund',
      ]) {
        expect(adapter.supports(eventType, { serverOnly: true })).toBe(true);
      }
    });

    it('returns true in instant mode for events with no browser-fired counterpart (Refund)', () => {
      // Refunds are server-authoritative only (never browser-fired, design §4.6),
      // so a server copy cannot double-count a gtag event → not suppressed.
      expect(adapter.supports('Refund')).toBe(true);
    });

    it('returns false for unmappable event types in both modes', () => {
      expect(adapter.supports('PageView')).toBe(false);
      expect(adapter.supports('PageView', { serverOnly: true })).toBe(false);
      expect(adapter.supports('')).toBe(false);
    });
  });

  describe('build', () => {
    it('maps canonical event types to GA4 Measurement Protocol event names', () => {
      const cases: Array<[string, string]> = [
        ['Purchase', 'purchase'],
        ['AddToCart', 'add_to_cart'],
        ['InitiateCheckout', 'begin_checkout'],
        ['ViewContent', 'view_item'],
        ['Search', 'search'],
        ['CompleteRegistration', 'sign_up'],
        ['AddPaymentInfo', 'add_payment_info'],
        ['Refund', 'refund'],
      ];
      for (const [eventType, ga4Name] of cases) {
        const payload = adapter.build(
          { ...snapshot, eventType, eventId: `evt-${eventType}` },
          ctx,
          normalizer,
        )!;
        expect(payload.eventName).toBe(ga4Name);
        expect(payload.events[0].name).toBe(ga4Name);
      }
    });

    it('uses ctx.gaClientId as the raw client_id (never hashed)', () => {
      const payload = adapter.build(snapshot, ctx, normalizer)!;

      expect(payload.client_id).toBe('GA1.2.9876543210.1234567890');
      expect(payload.client_id).not.toBe(normalizer.hashExternalId('CUST-42'));
    });

    it('falls back to the raw external_id when gaClientId is absent', () => {
      const { gaClientId: _dropped, ...noGaClient } = ctx;
      const payload = adapter.build(
        snapshot,
        noGaClient as TrackingContextView,
        normalizer,
      )!;

      // GA4 takes the identifier raw (design §4.5), unlike Meta/TikTok hashing.
      expect(payload.client_id).toBe('CUST-42');
    });

    it('maps value, currency, items, content_type, and transaction_id into params', () => {
      const payload = adapter.build(snapshot, ctx, normalizer)!;
      const params = payload.events[0].params;

      expect(params.value).toBe(2500);
      expect(params.currency).toBe('BDT');
      expect(params.transaction_id).toBe('ord-1001');
      expect(params.items).toEqual([
        { item_id: 'sku-1', quantity: 2, price: 1000 },
        { item_id: 'sku-2', quantity: 1, price: 500 },
      ]);
      expect(params.content_type).toBe('product');
    });

    it('derives items from content_ids when contents are absent', () => {
      const payload = adapter.build(
        { ...snapshot, contents: undefined },
        ctx,
        normalizer,
      )!;

      expect(payload.events[0].params.items).toEqual([
        { item_id: 'sku-1' },
        { item_id: 'sku-2' },
      ]);
      expect(payload.events[0].params.content_type).toBe('product');
    });

    it('maps search_string to search_term', () => {
      const payload = adapter.build(
        { ...snapshot, eventType: 'Search', eventId: 'search-1' },
        ctx,
        normalizer,
      )!;

      expect(payload.events[0].params.search_term).toBe('organic rice');
    });

    it('records eventTime in microseconds (timestamp_micros)', () => {
      const payload = adapter.build(snapshot, ctx, normalizer)!;

      expect(payload.events[0].params.timestamp_micros).toBe(
        payload.eventTime * 1000,
      );
    });

    it('uses snapshot.eventTime as the business event time when provided', () => {
      const payload = adapter.build(
        { ...snapshot, eventTime: 1700000000 },
        ctx,
        normalizer,
      )!;

      expect(payload.eventTime).toBe(1700000000);
      expect(payload.events[0].params.timestamp_micros).toBe(1700000000000);
    });

    it('maps Refund to the refund event with a positive value and refund_ event_id', () => {
      const payload = adapter.build(
        { ...snapshot, eventType: 'Refund', value: 2500 },
        ctx,
        normalizer,
      )!;

      expect(payload.eventName).toBe('refund');
      expect(payload.events[0].name).toBe('refund');
      // GA4 refunds carry the refund amount positively (the event name is the signal).
      expect(payload.events[0].params.value).toBe(2500);
      expect(payload.eventId).toBe('refund_ord-1001');
    });

    it('defaults to Purchase when value is present and eventType is absent', () => {
      const { eventType: _dropped, ...noType } = snapshot;
      const payload = adapter.build(
        noType as TrackingSnapshotPayload,
        ctx,
        normalizer,
      )!;

      expect(payload.eventName).toBe('purchase');
    });

    it('build is policy-agnostic: it maps Purchase even though instant-mode supports() returns false', () => {
      // The dispatch policy lives in supports(); the dispatcher gates via
      // supports(eventType, { serverOnly }) before calling build. build must not
      // re-apply the instant-mode suppression, or validated/offline Purchases
      // (which reach build only after a serverOnly gate) would be dropped.
      expect(adapter.supports('Purchase')).toBe(false);
      expect(adapter.build(snapshot, ctx, normalizer)).not.toBeNull();
    });

    it('returns null for unmappable event types', () => {
      expect(
        adapter.build({ ...snapshot, eventType: 'PageView' }, ctx, normalizer),
      ).toBeNull();
    });

    it('returns null when the event type is ambiguous (no eventType, no value)', () => {
      const { eventType: _dropped, value: _droppedValue, ...minimal } = snapshot;
      expect(
        adapter.build(minimal as TrackingSnapshotPayload, ctx, normalizer),
      ).toBeNull();
    });

    it('returns null when no dedup event id can be determined', () => {
      expect(
        adapter.build(
          { ...snapshot, eventType: 'ViewContent' },
          ctx,
          normalizer,
        ),
      ).toBeNull();
    });
  });

  describe('send', () => {
    const cfg = {
      measurementId: 'G-XXXXXXXX',
      apiSecret: 'SECRET123',
    };

    const originalFetch = global.fetch;

    afterEach(() => {
      (global.fetch as jest.Mock | undefined)?.mockRestore?.();
      global.fetch = originalFetch;
    });

    it('returns ok:true on 204 and posts to the MP collect endpoint with measurement_id + api_secret', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(204, ''));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          retryable: false,
          httpStatus: 204,
          providerEventId: 'purchase_ord-1001',
        }),
      );

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe(
        'https://www.google-analytics.com/mp/collect?measurement_id=G-XXXXXXXX&api_secret=SECRET123',
      );
      const body = JSON.parse(init.body);
      expect(body.client_id).toBe('GA1.2.9876543210.1234567890');
      expect(body.events).toHaveLength(1);
      expect(body.events[0].name).toBe('purchase');
      expect(body.events[0].params.value).toBe(2500);
      expect(body.events[0].params.transaction_id).toBe('ord-1001');
    });

    it('returns ok:true on a 200 response', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(200, ''));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result.ok).toBe(true);
      expect(result.httpStatus).toBe(200);
    });

    it('returns retryable:false on a 4xx (non-429) response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(400, '{"error":"bad"}'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: false, httpStatus: 400 }),
      );
      expect(result.rawResponse).toContain('bad');
    });

    it('returns retryable:true on a 429 response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(429, '{"error":"throttle"}'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: true, httpStatus: 429 }),
      );
    });

    it('returns retryable:true on a 5xx response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(500, '{"error":"boom"}'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: true, httpStatus: 500 }),
      );
    });

    it('truncates rawResponse to at most 500 characters', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(500, 'x'.repeat(2000)));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result.rawResponse!.length).toBeLessThanOrEqual(500);
    });

    it('returns retryable:true on a network error / timeout', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new TypeError('fetch failed'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: true }),
      );
      expect(result.rawResponse).toContain('fetch failed');
    });

    it('returns retryable:false without calling fetch when config lacks measurementId or apiSecret', async () => {
      global.fetch = jest.fn();
      const result = await adapter.send(wirePayload(), {});

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: false, httpStatus: 0 }),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
