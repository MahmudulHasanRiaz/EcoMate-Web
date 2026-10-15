import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { CourierManagerService } from '../courier-manager.service';
import { CourierManagerController } from '../courier-manager.controller';

/**
 * Task 6 (RedX PATCH + doc payload + sandbox test) — TDD spec.
 *
 * Doc-literal choices (REDx API and Webhook Documentation.md, Create Parcel
 * table + samples), each locked by a test below:
 * - parcel_weight: STRING grams (table says string; sample bare placeholder).
 * - value: STRING (table says string; sample bare placeholder).
 * - cash_collection_amount: STRING (table says string; sample quoted).
 * - pickup_store_id: optional STRING, sent only when configured
 *   (no config field exists → omitted when unconfigured).
 * - is_closed_box: KEPT (doc sample shows it; table omits it).
 * - parcel_details_json: ARRAY of {name, category, value} (doc sample shape;
 *   table prose says "object" but its own detail table describes item objects).
 * - merchant_order_amount / parcel_weight_in_gram: NOT in doc → dropped /
 *   renamed to doc `parcel_weight`. merchant_invoice_id=displayId kept.
 * - Create response: top-level {tracking_id} (doc sample); nested
 *   data.tracking_id tolerated (legacy). Cancel response {success, message}.
 */
describe('CourierManagerService — Task 6 RedX PATCH + doc payload', () => {
  let service: CourierManagerService;
  let prisma: any;
  const originalFetch = global.fetch;

  const tokenStore: any = {
    getAccessToken: jest.fn().mockResolvedValue('TOK'),
  };

  function credsFor(courier: string) {
    return {
      courier,
      enabled: true,
      mode: 'sandbox',
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      username: 'user@merchant.com',
      password: 'pass',
      credentials: {},
    };
  }

  const order: any = {
    id: 'order-1',
    displayId: 'ORD-1',
    total: 500,
    payments: [],
    customerFirstName: 'Test',
    customerLastName: 'User',
    customerPhone: '01712345678',
    customerEmail: null,
    guestName: null,
    guestPhone: null,
    secondaryPhone: null,
    officeNotes: null,
    shippingAddress: { address: 'Dhaka', district: 'Dhaka', deliveryType: 'home' },
    customer: { name: 'Test', phone: '01712345678', email: null },
    items: [{ product: { name: 'Item' }, price: 500 }],
  };

  beforeEach(() => {
    prisma = {
      courierCredentials: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(credsFor(where.courier)),
        ),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([order]),
        findUnique: jest.fn().mockResolvedValue({ timeline: [] }),
        findFirst: jest.fn().mockResolvedValue({ id: 'order-1' }),
        update: jest.fn().mockResolvedValue(order),
      },
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new CourierManagerService(prisma as any, tokenStore as any);
    tokenStore.getAccessToken.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(res: Response) {
    global.fetch = jest.fn().mockResolvedValue(res);
  }

  describe('cancelRedxParcel', () => {
    it('uses PATCH /parcels with the doc-shaped cancel body', async () => {
      mockFetch(
        new Response(
          JSON.stringify({ success: true, message: 'Request Accepted' }),
          { status: 200 },
        ),
      );

      await service.cancelRedxParcel('RX-CANCEL-1', 'Customer requested cancel');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts]: any[] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toMatch(/\/parcels$/);
      expect(opts.method).toBe('PATCH');
      expect(opts.method).not.toBe('PUT');
      expect(JSON.parse(opts.body)).toEqual({
        entity_type: 'parcel-tracking-id',
        entity_id: 'RX-CANCEL-1',
        update_details: {
          property_name: 'status',
          new_value: 'cancelled',
          reason: 'Customer requested cancel',
        },
      });
    });

    it('returns the doc {success, message} shape on accept', async () => {
      mockFetch(
        new Response(
          JSON.stringify({ success: true, message: 'Request Accepted' }),
          { status: 200 },
        ),
      );

      const res: any = await service.cancelRedxParcel('RX-CANCEL-2', 'reason');

      expect(res.success).toBe(true);
      expect(res.message).toBe('Request Accepted');
    });

    it('throws when the doc response reports success:false', async () => {
      mockFetch(
        new Response(
          JSON.stringify({ success: false, message: 'Already delivered' }),
          { status: 200 },
        ),
      );

      await expect(
        service.cancelRedxParcel('RX-CANCEL-3', 'reason'),
      ).rejects.toThrow('Already delivered');
    });
  });

  describe('dispatchRedx create payload (doc-aligned)', () => {
    function dispatchedBody(): Record<string, any> {
      const call = (global.fetch as jest.Mock).mock.calls.find((c) =>
        String(c[0]).endsWith('/parcel'),
      );
      expect(call).toBeDefined();
      return JSON.parse(call[1].body);
    }

    it('sends doc field names with doc-literal types', async () => {
      mockFetch(
        new Response(JSON.stringify({ data: { tracking_id: 'RX-LEGACY' } }), {
          status: 200,
        }),
      );

      const results = await service.dispatch('redx', ['order-1']);

      expect(results[0].ok).toBe(true);
      const body = dispatchedBody();
      // Doc table keys present with doc-literal types.
      expect(body.customer_name).toBe('Test User');
      expect(body.customer_phone).toBe('01712345678');
      expect(body.delivery_area).toBe('Dhaka');
      expect(body.delivery_area_id).toBe(1);
      expect(typeof body.cash_collection_amount).toBe('string');
      expect(typeof body.parcel_weight).toBe('string');
      expect(typeof body.value).toBe('string');
      expect(body.merchant_invoice_id).toBe('ORD-1');
      // is_closed_box kept (doc sample shows it).
      expect(body).toHaveProperty('is_closed_box');
      // parcel_details_json is an array of item objects (doc sample shape).
      expect(Array.isArray(body.parcel_details_json)).toBe(true);
      expect(body.parcel_details_json[0]).toEqual(
        expect.objectContaining({ name: expect.any(String) }),
      );
      // Non-doc keys are gone.
      expect(body).not.toHaveProperty('merchant_order_amount');
      expect(body).not.toHaveProperty('parcel_weight_in_gram');
      // Optional pickup_store_id omitted when unconfigured.
      expect(body).not.toHaveProperty('pickup_store_id');
    });

    it('parses the doc top-level tracking_id response', async () => {
      mockFetch(
        new Response(JSON.stringify({ tracking_id: 'RX-TOP-1' }), {
          status: 200,
        }),
      );

      const results = await service.dispatch('redx', ['order-1']);

      expect(results[0].ok).toBe(true);
      expect(results[0].trackingCode).toBe('RX-TOP-1');
    });

    it('still parses the legacy nested data.tracking_id response', async () => {
      mockFetch(
        new Response(JSON.stringify({ data: { tracking_id: 'RX-NESTED-1' } }), {
          status: 200,
        }),
      );

      const results = await service.dispatch('redx', ['order-1']);

      expect(results[0].ok).toBe(true);
      expect(results[0].trackingCode).toBe('RX-NESTED-1');
    });
  });
});

describe('CourierManagerController — Task 6 RedX cancel route', () => {
  it('exposes cancel as PATCH redx/cancel/:trackingId (PUT path deleted)', () => {
    const proto: any = CourierManagerController.prototype;
    const names = Object.getOwnPropertyNames(proto).filter(
      (n) =>
        Reflect.getMetadata(PATH_METADATA, proto[n]) ===
        'redx/cancel/:trackingId',
    );
    // Exactly one handler owns this path…
    expect(names).toHaveLength(1);
    // …and it is PATCH, not PUT.
    const method = Reflect.getMetadata(METHOD_METADATA, proto[names[0]]);
    expect(method).toBe(RequestMethod.PATCH);
    expect(method).not.toBe(RequestMethod.PUT);
  });
});
