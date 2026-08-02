import { MetaAdapter } from '../adapters/meta.adapter';
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
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (test)',
  url: 'https://ecomate.example/checkout',
  referrer: 'https://ecomate.example/product/sku-1',
  fbp: 'fb.1.1699999999999.1234567890',
  fbc: 'fb.1.1699999999999.AwBxYz',
};

const mockResponse = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

const wirePayload = (over: Partial<ProviderPayload> = {}): ProviderPayload => ({
  eventName: 'Purchase',
  eventId: 'purchase_ord-1001',
  eventTime: 1722600000,
  eventType: 'Purchase',
  action_source: 'website',
  event_source_url: 'https://ecomate.example/checkout',
  user_data: { em: 'abc123' },
  custom_data: { value: 2500, currency: 'BDT' },
  ...over,
});

describe('MetaAdapter (design §4.6 — Meta CAPI provider adapter)', () => {
  const adapter = new MetaAdapter();

  describe('provider metadata', () => {
    it('declares provider, version, and API version', () => {
      expect(adapter.provider).toBe('meta');
      expect(adapter.version).toBe(1);
      expect(adapter.providerApiVersion).toBe('v22.0');
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
      const payload = adapter.build(snapshot, ctx, normalizer);

      expect(payload).not.toBeNull();
      const u = payload!.user_data;
      expect(u.em).toBe(normalizer.hashEmail('John.Doe@Example.com'));
      expect(u.ph).toBe(normalizer.hashPhone('01712345678', 'BD'));
      expect(u.fn).toBe(normalizer.hashName('John'));
      expect(u.ln).toBe(normalizer.hashName('Doe'));
      expect(u.ct).toBe(normalizer.hashCity('Dhaka'));
      expect(u.cn).toBe(normalizer.hashCountry('BD'));
      expect(u.st).toBe(normalizer.hashState('Dhaka'));
      expect(u.zp).toBe(normalizer.hashZip('1212'));
      expect(u.external_id).toBe(normalizer.hashExternalId('CUST-42'));
      // never hashed — raw passthrough from context
      expect(u.fbp).toBe(ctx.fbp);
      expect(u.fbc).toBe(ctx.fbc);
      expect(u.client_ip_address).toBe(ctx.ip);
      expect(u.client_user_agent).toBe(ctx.userAgent);
    });

    it('builds the canonical Meta event envelope from the snapshot', () => {
      const payload = adapter.build(snapshot, ctx, normalizer)!;

      expect(payload.eventName).toBe('Purchase');
      expect(payload.eventType).toBe('Purchase');
      expect(payload.eventId).toBe('purchase_ord-1001');
      expect(Number.isInteger(payload.eventTime)).toBe(true);
      expect(payload.eventTime).toBeGreaterThanOrEqual(
        Math.floor(Date.now() / 1000) - 5,
      );
      expect(payload.eventTime).toBeLessThanOrEqual(
        Math.floor(Date.now() / 1000) + 1,
      );
      expect(payload.action_source).toBe('website');
      expect(payload.event_source_url).toBe(ctx.url);
    });

    it('uses snapshot.eventTime as the business event time when provided', () => {
      const payload = adapter.build(
        { ...snapshot, eventTime: 1700000000 },
        ctx,
        normalizer,
      )!;

      expect(payload.eventTime).toBe(1700000000);
    });

    it('maps custom_data (value, currency, content_ids, contents, num_items, search_string, order_id)', () => {
      const c = adapter.build(snapshot, ctx, normalizer)!.custom_data;

      expect(c.value).toBe(2500);
      expect(c.currency).toBe('BDT');
      expect(c.content_ids).toEqual(['sku-1', 'sku-2']);
      expect(c.contents).toEqual([
        { id: 'sku-1', quantity: 2, item_price: 1000 },
        { id: 'sku-2', quantity: 1, item_price: 500 },
      ]);
      expect(c.num_items).toBe(3);
      expect(c.search_string).toBe('organic rice');
      expect(c.order_id).toBe('ord-1001');
    });

    it('passes content_type, content_name, and content_category through to custom_data', () => {
      const c = adapter.build(
        {
          ...snapshot,
          content_type: 'product',
          content_name: 'Organic Rice',
          content_category: 'Groceries',
        },
        ctx,
        normalizer,
      )!.custom_data;

      expect(c.content_type).toBe('product');
      expect(c.content_name).toBe('Organic Rice');
      expect(c.content_category).toBe('Groceries');
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

      expect(payload.user_data.em).toBeUndefined();
      expect(payload.user_data.ph).toBeUndefined();
      expect(payload.user_data.fn).toBeUndefined();
      expect(payload.user_data.ln).toBeUndefined();
      expect(payload.user_data.ct).toBeUndefined();
      expect(payload.user_data.cn).toBeUndefined();
      expect(payload.user_data.st).toBeUndefined();
      expect(payload.user_data.zp).toBeUndefined();
    });

    it('maps Refund to a Purchase event_name with a negative value and refund_ event_id', () => {
      const payload = adapter.build(
        { ...snapshot, eventType: 'Refund', value: 2500 },
        ctx,
        normalizer,
      )!;

      expect(payload.eventName).toBe('Purchase');
      expect(payload.eventType).toBe('Refund'); // canonical type preserved
      expect(payload.eventId).toBe('refund_ord-1001');
      expect(payload.custom_data.value).toBe(-2500);
    });

    it('defaults to Purchase when value is present and eventType is absent', () => {
      const { eventType: _dropped, ...noType } = snapshot;
      const payload = adapter.build(noType as TrackingSnapshotPayload, ctx, normalizer)!;

      expect(payload.eventName).toBe('Purchase');
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
          { ...snapshot, eventType: 'ViewContent' },
          ctx,
          normalizer,
        ),
      ).toBeNull();
    });
  });

  describe('send', () => {
    const cfg = {
      pixelId: 'PIXEL123',
      accessToken: 'TOK',
      testEventCode: 'TEST123',
    };

    const originalFetch = global.fetch;

    afterEach(() => {
      (global.fetch as jest.Mock | undefined)?.mockRestore?.();
      global.fetch = originalFetch;
    });

    it('returns ok:true on 2xx and posts to the Meta endpoint with access_token + body', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(200, '{"ok":true}'));

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
        'https://graph.facebook.com/v22.0/PIXEL123/events?access_token=TOK',
      );
      const body = JSON.parse(init.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].event_name).toBe('Purchase');
      expect(body.data[0].event_id).toBe('purchase_ord-1001');
      expect(body.data[0].event_time).toBe(1722600000);
      expect(body.data[0].action_source).toBe('website');
      expect(body.data[0].event_source_url).toBe(
        'https://ecomate.example/checkout',
      );
      expect(body.data[0].user_data.em).toBe('abc123');
      expect(body.data[0].custom_data.value).toBe(2500);
      expect(body.test_event_code).toBe('TEST123');
    });

    it('omits test_event_code when not configured', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(200, '{}'));

      await adapter.send(wirePayload(), {
        pixelId: 'PIXEL123',
        accessToken: 'TOK',
      });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body).not.toHaveProperty('test_event_code');
    });

    it('returns retryable:false on a 4xx (non-429) response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(400, '{"error":{"message":"bad"}}'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: false, httpStatus: 400 }),
      );
      expect(result.rawResponse).toContain('bad');
    });

    it('returns retryable:true on a 429 response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(429, '{"error":{"message":"throttle"}}'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: true, httpStatus: 429 }),
      );
    });

    it('returns retryable:true on a 5xx response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(500, '{"error":{"message":"boom"}}'));

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

    it('returns retryable:false without calling fetch when config lacks pixelId or accessToken', async () => {
      global.fetch = jest.fn();
      const result = await adapter.send(wirePayload(), {});

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: false, httpStatus: 0 }),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
