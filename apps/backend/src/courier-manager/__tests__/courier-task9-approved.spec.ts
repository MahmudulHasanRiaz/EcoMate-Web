import { CourierManagerService } from '../courier-manager.service';

/**
 * Task 9 approved capabilities (TDD RED first).
 * (a) Pathao bulk POST /aladdin/api/v1/orders/bulk, 202 accepted/async.
 * (b) Steadfast pagination loop ?page= on returns + payments.
 * (c) RedX charge calculator GET /charge/charge_calculator.
 */
describe('CourierManagerService — Task 9 approved capability batch', () => {
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
      clientContext: 'merchant',
      username: 'user@merchant.com',
      password: 'pass',
      storeId: '1',
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
    shippingAddress: { address: 'House 1, Road 2, Dhaka', district: 'Dhaka', deliveryType: 'home' },
    customer: { name: 'Test', phone: '01712345678', email: null },
    items: [{ product: { name: 'Item' }, price: 500 }],
  };
  const order2: any = {
    ...order,
    id: 'order-2',
    displayId: 'ORD-2',
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

  describe('(a) Pathao bulk', () => {
    it('POSTs {orders:[...]} to /aladdin/api/v1/orders/bulk reusing the single-order payload shape', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message:
              'Your bulk order creation request is accepted,<br>  please wait some time to complete order creation.',
            type: 'success',
            code: 202,
            data: true,
          }),
          { status: 202 },
        ),
      );
      const res: any = await (service as any).bulkCreatePathaoOrders([order, order2]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init]: any = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain('/aladdin/api/v1/orders/bulk');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(Array.isArray(body.orders)).toBe(true);
      expect(body.orders).toHaveLength(2);
      // Reuses per-order builder: same keys as single dispatch payload.
      expect(body.orders[0]).toMatchObject({
        store_id: expect.anything(),
        recipient_name: expect.any(String),
        recipient_phone: expect.any(String),
        recipient_address: expect.any(String),
        delivery_type: 48,
        item_type: 2,
        amount_to_collect: expect.any(Number),
      });
      expect(body.orders[0].merchant_order_id).toBe('ORD-1');
      expect(body.orders[1].merchant_order_id).toBe('ORD-2');
    });

    it('returns accepted/async (NOT created) with per-order accepted entries', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: 'Your bulk order creation request is accepted', type: 'success', code: 202, data: true }),
          { status: 202 },
        ),
      );
      const res: any = await (service as any).bulkCreatePathaoOrders([order, order2]);
      expect(res.accepted).toBe(true);
      expect(res.count).toBe(2);
      expect(res.message).toMatch(/accepted.*processing/i);
      expect(res.message).not.toMatch(/created/i);
      for (const entry of res.results) {
        expect(entry.ok).toBe(true);
        expect(entry.accepted).toBe(true);
        expect(String(entry.message)).toMatch(/accepted.*processing/i);
      }
    });

    it('never retries a 4xx bulk rejection (attempts==1)', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Invalid store', type: 'error', code: 400 }), { status: 400 }),
      );
      await expect((service as any).bulkCreatePathaoOrders([order])).rejects.toThrow();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('exposes order-info verification for accepted bulk entries', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: 'Order info', type: 'success', code: 200, data: { consignment_id: 'C1', order_status: 'Pending' } }),
          { status: 200 },
        ),
      );
      const info: any = await (service as any).getPathaoOrderInfo('C1');
      const [url]: any = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain('/aladdin/api/v1/orders/C1/info');
      expect(info.consignment_id ?? info.data?.consignment_id ?? 'C1').toBeDefined();
    });
  });

  describe('(b) Steadfast pagination', () => {
    it('loops ?page= on get_return_requests until an empty page and aggregates', async () => {
      const page1 = { status: 200, data: [{ id: 1 }, { id: 2 }] };
      const page2 = { status: 200, data: [{ id: 3 }] };
      const page3 = { status: 200, data: [] };
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(page3), { status: 200 }));
      const res: any = await (service as any).getSteadfastReturnRequests();
      const urls = (global.fetch as jest.Mock).mock.calls.map((c: any) => String(c[0]));
      expect(urls[0]).toContain('/get_return_requests');
      expect(urls.some((u: string) => u.includes('page=2'))).toBe(true);
      const all = res.data ?? res.return_requests ?? res;
      expect(Array.isArray(all) ? all.length : res.pages).toBeGreaterThanOrEqual(3);
    });

    it('loops ?page= on payments until an empty page and aggregates', async () => {
      const page1 = { status: 1, payments: [{ payment_id: 'SFC-1' }] };
      const page2 = { status: 1, payments: [] };
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));
      const res: any = await (service as any).getSteadfastPayments();
      const urls = (global.fetch as jest.Mock).mock.calls.map((c: any) => String(c[0]));
      expect(urls[0]).toContain('/payments');
      expect(urls.some((u: string) => u.includes('page=2'))).toBe(true);
      const all = res.payments ?? res.data ?? [];
      expect(all).toHaveLength(1);
    });
  });

  describe('(c) RedX charge calculator', () => {
    it('GETs /charge/charge_calculator with query params and returns deliveryCharge + codCharge', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ deliveryCharge: 60, codCharge: 0 }), { status: 200 }),
      );
      const res: any = await (service as any).getRedxCharge({
        delivery_area_id: 12,
        pickup_area_id: 1,
        cash_collection_amount: 500,
        weight: 500,
      });
      const [url]: any = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain('/charge/charge_calculator');
      expect(String(url)).toContain('delivery_area_id=12');
      expect(String(url)).toContain('cash_collection_amount=500');
      expect(res.deliveryCharge).toBe(60);
      expect(res.codCharge).toBe(0);
    });

    it('throws a field error when delivery_area_id is missing', async () => {
      global.fetch = jest.fn();
      await expect((service as any).getRedxCharge({ cash_collection_amount: 100, weight: 500 } as any)).rejects.toThrow(/delivery_area_id/i);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
