import {
  GoogleAdsAdapter,
  TrackingProviderAdapter,
  buildAdapterRegistry,
  getAdapter,
  listAdapters,
  registerAdapter,
} from '../adapters';
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

/** TrackingContextView is extended at the adapter boundary with gbraid. */
const ctx: TrackingContextView & { gbraid?: string } = {
  externalId: 'CUST-42',
  gclid: 'GCLID-ABC-123',
  gbraid: 'GBRAID-XYZ-789',
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
  eventName: 'Purchase',
  eventId: 'purchase_ord-1001',
  eventTime: 1722600000,
  eventType: 'Purchase',
  conversionAction: 'Purchase',
  gclid: 'GCLID-ABC-123',
  gbraid: 'GBRAID-XYZ-789',
  conversionDateTime: new Date(1722600000 * 1000).toISOString(),
  conversionValue: 2500,
  currencyCode: 'BDT',
  orderId: 'ord-1001',
  userIdentifiers: [
    { hashedEmail: normalizer.hashEmail('John.Doe@Example.com') },
    { hashedPhoneNumber: normalizer.hashPhone('01712345678', 'BD') },
  ],
  ...over,
});

describe('GoogleAdsAdapter (design §4.6 — Google Ads offline conversion provider adapter)', () => {
  const adapter = new GoogleAdsAdapter();

  describe('provider metadata', () => {
    it('declares provider, version, and API version', () => {
      expect(adapter.provider).toBe('google_ads');
      expect(adapter.version).toBe(1);
      expect(adapter.providerApiVersion).toBe('offline-conversion');
    });
  });

  describe('supports', () => {
    it('returns true only for Purchase and Refund', () => {
      expect(adapter.supports('Purchase')).toBe(true);
      expect(adapter.supports('Refund')).toBe(true);
      expect(adapter.supports('AddToCart')).toBe(false);
      expect(adapter.supports('InitiateCheckout')).toBe(false);
      expect(adapter.supports('ViewContent')).toBe(false);
      expect(adapter.supports('Lead')).toBe(false);
      expect(adapter.supports('PageView')).toBe(false);
      expect(adapter.supports('')).toBe(false);
    });
  });

  describe('build', () => {
    it('builds the offline conversion payload with raw gclid/gbraid and hashed identifiers', () => {
      const payload = adapter.build(snapshot, ctx, normalizer)!;

      expect(payload).not.toBeNull();
      expect(payload.eventName).toBe('Purchase');
      expect(payload.eventId).toBe('purchase_ord-1001');
      expect(payload.eventType).toBe('Purchase');
      expect(payload.conversionAction).toBe('Purchase');
      // click identifiers pass through raw — never hashed
      expect(payload.gclid).toBe('GCLID-ABC-123');
      expect(payload.gbraid).toBe('GBRAID-XYZ-789');
      expect(payload.conversionDateTime).toBe(
        new Date(payload.eventTime * 1000).toISOString(),
      );
      expect(payload.conversionValue).toBe(2500);
      expect(payload.currencyCode).toBe('BDT');
      expect(payload.orderId).toBe('ord-1001');
      expect(payload.userIdentifiers).toContainEqual({
        hashedEmail: normalizer.hashEmail('John.Doe@Example.com'),
      });
      expect(payload.userIdentifiers).toContainEqual({
        hashedPhoneNumber: normalizer.hashPhone('01712345678', 'BD'),
      });
    });

    it('defaults to Purchase when value is present and eventType is absent', () => {
      const { eventType: _dropped, ...noType } = snapshot;
      const payload = adapter.build(
        noType as TrackingSnapshotPayload,
        ctx,
        normalizer,
      )!;

      expect(payload.eventName).toBe('Purchase');
      expect(payload.conversionValue).toBe(2500);
    });

    it('maps Refund to a negated conversionValue and a distinct refund_ event id', () => {
      const payload = adapter.build(
        { ...snapshot, eventType: 'Refund', value: 2500 },
        ctx,
        normalizer,
      )!;

      expect(payload.eventName).toBe('Refund');
      expect(payload.eventId).toBe('refund_ord-1001');
      // Refund = negative-value conversion; distinct event_id keeps the refund's
      // dispatch record from colliding with the original purchase (Google Ads
      // dedups on order_id, so the orderId field itself stays raw/positive).
      expect(payload.conversionValue).toBe(-2500);
      expect(payload.orderId).toBe('ord-1001');
    });

    it('omits missing identifiers from userIdentifiers', () => {
      const payload = adapter.build(
        {
          ...snapshot,
          customer: { email: 'John.Doe@Example.com' },
        },
        ctx,
        normalizer,
      )!;

      expect(payload.userIdentifiers).toEqual([
        { hashedEmail: normalizer.hashEmail('John.Doe@Example.com') },
      ]);
    });

    it('returns null for unsupported event types', () => {
      expect(
        adapter.build({ ...snapshot, eventType: 'AddToCart' }, ctx, normalizer),
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
          { ...snapshot, orderId: undefined, eventId: undefined },
          ctx,
          normalizer,
        ),
      ).toBeNull();
    });
  });

  describe('send', () => {
    const cfg = {
      conversionId: 'CONV-123',
      conversionLabel: 'purchase-label',
    };

    const originalFetch = global.fetch;

    afterEach(() => {
      (global.fetch as jest.Mock | undefined)?.mockRestore?.();
      global.fetch = originalFetch;
    });

    it('returns ok:true on 200 and posts to the gtag conversion endpoint with conversionId from cfg', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(200, 'OK'));

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
        'https://www.googleadservices.com/pagead/conversion/CONV-123/?label=purchase-label&value=2500&currency_code=BDT',
      );
      const body = JSON.parse(init.body);
      expect(body.gclid).toBe('GCLID-ABC-123');
      expect(body.conversion_id).toBe('ord-1001');
      expect(body.conversion_value).toBe(2500);
      expect(body.conversion_currency).toBe('BDT');
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

    it('returns retryable:true on a network error / timeout', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

      const result = await adapter.send(wirePayload(), cfg);

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: true }),
      );
      expect(result.rawResponse).toContain('fetch failed');
    });

    it('sends gbraid (not gclid) when gclid is absent', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(200, 'OK'));

      const result = await adapter.send(
        wirePayload({ gclid: undefined }),
        cfg,
      );

      expect(result.ok).toBe(true);
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.gclid).toBeUndefined();
      expect(body.gbraid).toBe('GBRAID-XYZ-789');
    });

    it('returns retryable:false without calling fetch when config lacks conversionId', async () => {
      global.fetch = jest.fn();
      const result = await adapter.send(wirePayload(), {});

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: false, httpStatus: 0 }),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns retryable:false without calling fetch when neither gclid nor gbraid is present', async () => {
      global.fetch = jest.fn();
      const result = await adapter.send(
        wirePayload({ gclid: undefined, gbraid: undefined }),
        cfg,
      );

      expect(result).toEqual(
        expect.objectContaining({ ok: false, retryable: false, httpStatus: 0 }),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

describe('adapter registry assembly (Task 5 — buildAdapterRegistry)', () => {
  it('builds a registry containing all four concrete providers', () => {
    const adapters = buildAdapterRegistry();

    const providers = adapters.map((a) => a.provider).sort();
    expect(providers).toEqual(['ga4', 'google_ads', 'meta', 'tiktok']);

    // The same instances are live in the module-level registry.
    const registeredProviders = listAdapters()
      .map((a) => a.provider)
      .sort();
    for (const p of ['meta', 'tiktok', 'ga4', 'google_ads']) {
      expect(registeredProviders).toContain(p);
    }
  });

  it('resolves concrete adapters via getAdapter', () => {
    buildAdapterRegistry();

    const meta = getAdapter('meta');
    expect(meta).toBeInstanceOf(MetaAdapter);
    expect(meta!.provider).toBe('meta');

    const ads = getAdapter('google_ads');
    expect(ads).toBeInstanceOf(GoogleAdsAdapter);
    expect(ads!.provider).toBe('google_ads');
  });

  it('overwrites a prior registration on the same provider+version (later wins)', () => {
    const stub: TrackingProviderAdapter = {
      provider: 'google_ads',
      version: 1,
      providerApiVersion: 'stale',
      supports: () => false,
      build: () => null,
      send: async () => ({ ok: true, retryable: false }),
    };
    registerAdapter(stub);

    // Rebuilding the registry re-registers the real adapter over the stub.
    buildAdapterRegistry();
    expect(getAdapter('google_ads')).toBeInstanceOf(GoogleAdsAdapter);
  });
});
