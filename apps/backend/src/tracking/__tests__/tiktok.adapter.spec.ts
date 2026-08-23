import { TikTokAdapter } from '../adapters/tiktok.adapter';
import { ProviderPayload } from '../adapters/tracking-provider.adapter';
import { TrackingNormalizer } from '../tracking.normalizer';
import {
  TrackingContextView,
  TrackingSnapshotPayload,
} from '../tracking-snapshot.types';

const normalizer = new TrackingNormalizer();

const snapshot: TrackingSnapshotPayload = {
  eventType: 'Purchase',
  eventId: 'purchase_ord-1001',
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
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (test)',
  url: 'https://ecomate.example/checkout',
  referrer: 'https://ecomate.example/product/sku-1',
};

const mockResponse = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  // Model a real fetch Response: json() parses the same body. Invalid JSON
  // (e.g. the 2000-char truncation fixture) rejects, as a real Response would.
  json: async () => JSON.parse(body),
});

const wirePayload = (over: Partial<ProviderPayload> = {}): ProviderPayload => ({
  eventName: 'CompletePayment',
  eventId: 'purchase_ord-1001',
  eventTime: 1722600000,
  eventType: 'Purchase',
  context: {
    ip: '203.0.113.7',
    user_agent: 'Mozilla/5.0 (test)',
    page: {
      url: 'https://ecomate.example/checkout',
      referrer: 'https://ecomate.example/product/sku-1',
    },
    user: { email: 'abc123' },
  },
  properties: { value: 2500, currency: 'BDT' },
  ...over,
});

describe('TikTokAdapter (design §4.6 — TikTok Events API provider adapter)', () => {
  const adapter = new TikTokAdapter();

  describe('provider metadata', () => {
    it('declares provider, version, and API version', () => {
      expect(adapter.provider).toBe('tiktok');
      expect(adapter.version).toBe(1);
      expect(adapter.providerApiVersion).toBe('v1.3');
    });
  });

  describe('supports', () => {
    it('returns true for every standard web event type', () => {
      for (const eventType of [
        'Purchase',
        'Refund',
        'AddToCart',
        'InitiateCheckout',
        'AddPaymentInfo',
        'ViewContent',
        'Search',
        'CompleteRegistration',
        'Lead',
      ]) {
        expect(adapter.supports(eventType)).toBe(true);
      }
    });

    it('returns false for non-web / unsupported event types', () => {
      expect(adapter.supports('PageView')).toBe(false);
      expect(adapter.supports('Subscribe')).toBe(false);
      expect(adapter.supports('')).toBe(false);
    });
  });

  describe('build', () => {
    it('hashes customer PII via the normalizer and passes raw identifiers through', () => {
      const payload = adapter.build(snapshot, ctx, normalizer)!;

      expect(payload).not.toBeNull();
      const u = payload.context.user;
      expect(u.email).toBe(normalizer.hashEmail('John.Doe@Example.com'));
      expect(u.phone_number).toBe(normalizer.hashPhone('01712345678', 'BD'));
      expect(u.external_id).toBe(normalizer.hashExternalId('CUST-42'));
      expect(u.first_name).toBe(normalizer.hashName('John'));
      expect(u.last_name).toBe(normalizer.hashName('Doe'));
      expect(u.city).toBe(normalizer.hashCity('Dhaka'));
      expect(u.state).toBe(normalizer.hashState('Dhaka'));
      expect(u.zip).toBe(normalizer.hashZip('1212'));
      expect(u.country).toBe(normalizer.hashCountry('BD'));
      // never hashed — raw passthrough from context
      expect(payload.context.ip).toBe(ctx.ip);
      expect(payload.context.user_agent).toBe(ctx.userAgent);
      expect(payload.context.page.url).toBe(ctx.url);
      expect(payload.context.page.referrer).toBe(ctx.referrer);
    });

    it('builds the TikTok wire-shape envelope from the snapshot', () => {
      const payload = adapter.build(snapshot, ctx, normalizer)!;

      expect(payload.eventName).toBe('CompletePayment'); // Purchase → CompletePayment
      expect(payload.eventType).toBe('Purchase');
      expect(payload.eventId).toBe('purchase_ord-1001');
      expect(Number.isInteger(payload.eventTime)).toBe(true);
      expect(payload.eventTime).toBeGreaterThanOrEqual(
        Math.floor(Date.now() / 1000) - 5,
      );
      expect(payload.eventTime).toBeLessThanOrEqual(
        Math.floor(Date.now() / 1000) + 1,
      );
    });

    it('uses snapshot.eventTime as the business event time when provided', () => {
      const payload = adapter.build(
        { ...snapshot, eventTime: 1700000000 },
        ctx,
        normalizer,
      )!;

      expect(payload.eventTime).toBe(1700000000);
    });

    it('maps properties (value, currency, content_ids, contents, num_items, search_string, order_id)', () => {
      const p = adapter.build(snapshot, ctx, normalizer)!.properties;

      expect(p.value).toBe(2500);
      expect(p.currency).toBe('BDT');
      expect(p.content_ids).toEqual(['sku-1', 'sku-2']);
      expect(p.contents).toEqual([
        { id: 'sku-1', quantity: 2, item_price: 1000 },
        { id: 'sku-2', quantity: 1, item_price: 500 },
      ]);
      expect(p.num_items).toBe(3);
      expect(p.search_string).toBe('organic rice');
      expect(p.order_id).toBe('ord-1001');
    });

    it('omits unset customer fields instead of hashing garbage', () => {
      const payload = adapter.build(
        {
          ...snapshot,
          customer: { email: 'cust_9@example.com' },
        },
        ctx,
        normalizer,
      )!;

      const u = payload.context.user;
      expect(u.email).toBeUndefined();
      expect(u.phone_number).toBeUndefined();
      expect(u.first_name).toBeUndefined();
      expect(u.last_name).toBeUndefined();
      expect(u.city).toBeUndefined();
      expect(u.state).toBeUndefined();
      expect(u.zip).toBeUndefined();
      expect(u.country).toBeUndefined();
    });

    it('maps Refund to CompletePayment with a negative value and refund_ event_id', () => {
      const payload = adapter.build(
        { ...snapshot, eventType: 'Refund', eventId: 'refund_ord-1001', value: 2500 },
        ctx,
        normalizer,
      )!;

      expect(payload.eventName).toBe('CompletePayment');
      expect(payload.eventType).toBe('Refund'); // canonical type preserved
      expect(payload.eventId).toBe('refund_ord-1001');
      expect(payload.properties.value).toBe(-2500);
    });

    it('splits a full name stored in firstName (guest checkout) into fn/ln hashes', () => {
      // Offline/guest orders store the FULL name in firstName (checkout-leads
      // line ~483: firstName = order.customer.name). Assert the last word is
      // hashed as last_name, the rest as first_name — never the whole name as
      // first_name with an absent last_name.
      const full = {
        ...snapshot,
        customer: {
          ...snapshot.customer!,
          firstName: 'Md Rahim Uddin',
          lastName: '',
        },
      };
      const payload = adapter.build(full, ctx, normalizer)!;
      const user = payload.context.user as Record<string, unknown>;
      expect(user.first_name).toBe(
        normalizer.hashName('Md Rahim'),
      );
      expect(user.last_name).toBe(
        normalizer.hashName('Uddin'),
      );
      expect(user.first_name).not.toBe(normalizer.hashName('Md Rahim Uddin'));
    });

    it('keeps explicit firstName + lastName untouched (two-field payloads never split)', () => {
      const payload = adapter.build(snapshot, ctx, normalizer)!;
      const user = payload.context.user as Record<string, unknown>;
      expect(user.first_name).toBe(normalizer.hashName('John'));
      expect(user.last_name).toBe(normalizer.hashName('Doe'));
    });

    it('defaults to Purchase when value is present and eventType is absent', () => {
      const { eventType: _dropped, ...noType } = snapshot;
      const payload = adapter.build(
        noType as TrackingSnapshotPayload,
        ctx,
        normalizer,
      )!;

      expect(payload.eventName).toBe('CompletePayment');
      expect(payload.eventId).toBe('purchase_ord-1001');
    });

    it('uses a caller-provided eventId for non-order events', () => {
      const payload = adapter.build(
        { ...snapshot, eventType: 'ViewContent', eventId: 'vc-abc' },
        ctx,
        normalizer,
      )!;

      expect(payload.eventName).toBe('ViewContent');
      expect(payload.eventId).toBe('vc-abc');
    });

    it('returns null for unsupported event types', () => {
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
          { ...snapshot, eventType: 'ViewContent', eventId: undefined },
          ctx,
          normalizer,
        ),
      ).toBeNull();
    });
  });

  describe('event_id cross-source dedup contract', () => {
    it('uses snapshot.eventId verbatim for Purchase (matches browser Pixel purchase_{uuid})', () => {
      const uuidSnapshot: TrackingSnapshotPayload = {
        ...snapshot,
        eventId: 'purchase_a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        orderId: 'ORD-260820-00123',
      };
      const payload = adapter.build(uuidSnapshot, ctx, normalizer)!;
      expect(payload.eventId).toBe('purchase_a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(payload.properties.order_id).toBe('ORD-260820-00123');
    });

    it('uses snapshot.eventId verbatim for Refund (matches capture refund_{uuid})', () => {
      const refundSnapshot: TrackingSnapshotPayload = {
        ...snapshot,
        eventType: 'Refund',
        eventId: 'refund_a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        orderId: 'ORD-260820-00123',
        value: 2500,
      };
      const payload = adapter.build(refundSnapshot, ctx, normalizer)!;
      expect(payload.eventId).toBe('refund_a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });
  });

  describe('send', () => {
    const cfg = {
      pixelCode: 'PIXEL123',
      accessToken: 'TOK',
    };

    const originalFetch = global.fetch;

    afterEach(() => {
      (global.fetch as jest.Mock | undefined)?.mockRestore?.();
      global.fetch = originalFetch;
    });

    it('returns ok:true on 2xx and posts the wire body to the TikTok endpoint with Access-Token', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(200, '{"code":0}'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          retryable: false,
          httpStatus: 200,
          providerEventId: 'purchase_ord-1001',
        }),
      );

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe(
        'https://business-api.tiktok.com/open_api/v1.3/pixel/track/',
      );
      expect(init.headers).toEqual(
        expect.objectContaining({ 'Access-Token': 'TOK' }),
      );
      const body = JSON.parse(init.body);
      expect(body.pixel_code).toBe('PIXEL123');
      expect(body.event).toBe('CompletePayment');
      expect(body.event_id).toBe('purchase_ord-1001');
      // P0 fix: v1.3 pixel/track requires ISO 8601 STRING timestamp — a JSON
      // number is rejected with 40002 ("Invalid value for timestamp: not a
      // valid string."), which DEAD'd 8559 outboxes.
      expect(body.timestamp).toBe('2024-08-02T12:00:00.000Z');
      expect(typeof body.timestamp).toBe('string');
      expect(body.context.page.url).toBe('https://ecomate.example/checkout');
      expect(body.context.user.email).toBe('abc123');
      expect(body.properties.value).toBe(2500);
    });

    it('includes test_event_code in the wire body when cfg.testEventCode is provided', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(200, '{"code":0}'));

      await adapter.send(wirePayload(), { ...cfg, testEventCode: 'TEST-UUID' });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.test_event_code).toBe('TEST-UUID');
    });

    it('omits test_event_code when not provided', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(200, '{"code":0}'));

      await adapter.send(wirePayload(), cfg);

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.test_event_code).toBeUndefined();
    });

    it('returns ok:false when TikTok returns HTTP 200 with a non-zero business-error body code', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ code: 10005, message: 'invalid' }),
      });

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: false, httpStatus: 200 }),
      );
      expect(result.rawResponse).toContain('10005');
      expect(result.rawResponse).toContain('invalid');
    });

    it('returns ok:true when TikTok returns HTTP 200 with body code 0', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 0 }),
      });

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: true, retryable: false }),
      );
    });

    it('marks known-transient business-error codes (40011) retryable', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ code: 40011, message: 'rate limit' }),
      });

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: true, httpStatus: 200 }),
      );
    });

    it('returns retryable:false on a 4xx (non-429) response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(400, '{"message":"bad"}'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: false, httpStatus: 400 }),
      );
      expect(result.rawResponse).toContain('bad');
    });

    it('returns retryable:true on a 429 response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(429, '{"message":"throttle"}'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: true, httpStatus: 429 }),
      );
    });

    it('returns retryable:true on a 5xx response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(500, '{"message":"boom"}'));

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

    it('truncates a long business-error message in the composed rawResponse', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ code: 10005, message: 'x'.repeat(2000) }),
      });

      const result = await adapter.send(wirePayload(), cfg);

      expect(result.rawResponse!.length).toBeLessThanOrEqual(500);
      expect(result.rawResponse).toContain('code:10005');
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

    it('returns retryable:false without calling fetch when config lacks pixelCode or accessToken', async () => {
      global.fetch = jest.fn();
      const result = await adapter.send(wirePayload(), {});

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: false, httpStatus: 0 }),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
