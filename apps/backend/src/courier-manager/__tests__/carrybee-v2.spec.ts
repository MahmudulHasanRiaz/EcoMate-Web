import { Test, TestingModule } from '@nestjs/testing';
import { CourierManagerService } from '../courier-manager.service';
import { CourierTrackingService } from '../courier-tracking.service';
import { CourierWebhookService } from '../courier-webhook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { CourierTokenService } from '../courier-token.service';
import { CacheService } from '../../cache/cache.service';

/**
 * Task 7 (owner-locked): Carrybee v2 rewrite — doc-exact mocked shapes.
 * Source: CarryBee API Docs.md (auth 3 headers, prod
 * https://developers.carrybee.com, sandbox https://sandbox.carrybee.com,
 * POST /api/v2/orders → 201 data.order.consignment_id,
 * GET /api/v2/orders/{id}/details, POST .../cancel → 202,
 * error {error,message} + 422 causes).
 */
describe('Carrybee v2 rewrite (Task 7, doc-exact mocked shapes)', () => {
  const originalFetch = global.fetch;

  const tokenStore: any = {
    getAccessToken: jest.fn().mockResolvedValue('TOK'),
  };

  function credsFor(courier: string, overrides: Record<string, unknown> = {}) {
    return {
      courier,
      enabled: true,
      mode: 'sandbox',
      apiKey: 'legacy-api-key-must-be-ignored',
      secretKey: 'test-secret-key',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      clientContext: 'test-context',
      username: 'user@merchant.com',
      password: 'pass',
      storeId: 'store-abc-123',
      credentials: {},
      ...overrides,
    };
  }

  const order: any = {
    id: 'order-1',
    displayId: 'ORD-1',
    total: 500,
    payments: [],
    customerFirstName: 'Karim',
    customerLastName: 'Uddin',
    customerPhone: '01712345678',
    customerEmail: null,
    guestName: null,
    guestPhone: null,
    secondaryPhone: null,
    officeNotes: null,
    shippingAddress: {
      address: 'House 5, Road 3, Banani',
      area: 'Banani',
      district: 'Dhaka',
    },
    customer: { name: 'Karim Uddin', phone: '01712345678', email: null },
    items: [{ product: { name: 'Item' } }],
  };

  let prisma: any;
  let manager: CourierManagerService;

  function mockFetchSequence(responses: Response[]) {
    const queue = [...responses];
    let last = queue[queue.length - 1];
    global.fetch = jest.fn().mockImplementation(() => {
      const next = queue.shift() ?? last;
      last = next;
      return Promise.resolve(next.clone());
    });
  }

  function sentBody(): Record<string, unknown> {
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return JSON.parse(calls[0][1].body);
  }

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
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    manager = new CourierManagerService(prisma as any, tokenStore as any);
    tokenStore.getAccessToken.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('dispatch POST /api/v2/orders', () => {
    const created201 = () =>
      new Response(
        JSON.stringify({
          error: false,
          message: 'Order created successfully',
          data: {
            order: {
              consignment_id: 'CBX-1',
              store_id: 'store-abc-123',
              merchant_order_id: 'ORD-1',
              collectable_amount: '500',
              cod_fee: 15,
              delivery_fee: '60',
            },
          },
        }),
        { status: 201 },
      );

    it('posts the doc-shaped v2 payload and resolves data.order.consignment_id', async () => {
      mockFetchSequence([created201()]);

      const results = await manager.dispatch('carrybee', ['order-1']);

      expect(results[0].ok).toBe(true);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toBe('https://sandbox.carrybee.com/api/v2/orders');
      expect(init.method).toBe('POST');
      expect(init.headers['Client-ID']).toBe('test-client-id');
      expect(init.headers['Client-Secret']).toBe('test-client-secret');
      expect(init.headers['Client-Context']).toBe('test-context');
      expect(String(url)).not.toContain('api_key');
      const body = sentBody();
      expect(body.store_id).toBe('store-abc-123');
      expect(body.merchant_order_id).toBe('ORD-1');
      expect(body.delivery_type).toBe(1);
      expect(body.product_type).toBe(1);
      expect(body.recipient_name).toBe('Karim Uddin');
      expect(body.recipient_phone).toBe('01712345678');
      expect(String(body.recipient_address).length).toBeGreaterThanOrEqual(10);
      expect(String(body.recipient_address).length).toBeLessThanOrEqual(200);
      expect(Number.isInteger(body.item_weight)).toBe(true);
      expect(body.item_weight).toBeGreaterThanOrEqual(1);
      expect(body.item_weight).toBeLessThanOrEqual(25000);
      expect(body.collectable_amount).toBeGreaterThanOrEqual(0);
      expect(body.collectable_amount).toBeLessThanOrEqual(100000);
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({
            courierService: 'carrybee',
            courierConsignmentId: 'CBX-1',
          }),
        }),
      );
    });

    it('uses the production host in production mode', async () => {
      prisma.courierCredentials.findUnique.mockImplementation(() =>
        Promise.resolve(credsFor('carrybee', { mode: 'production' })),
      );
      mockFetchSequence([created201()]);

      await manager.dispatch('carrybee', ['order-1']);

      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toBe(
        'https://developers.carrybee.com/api/v2/orders',
      );
    });

    it('422 causes surface per-field rules with no retry', async () => {
      mockFetchSequence([
        new Response(
          JSON.stringify({
            error: true,
            message: 'Validation error',
            causes: {
              recipient_phone: [{ type: 'required', attribute: {} }],
            },
          }),
          { status: 422 },
        ),
      ]);

      const results = await manager.dispatch('carrybee', ['order-1']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].status).toBe(422);
      expect(results[0].message).toContain("field 'recipient_phone'");
      expect(results[0].message).toContain('required');
      expect(results[0].errors).toEqual({
        recipient_phone: [{ type: 'required', attribute: {} }],
      });
    });

    it('missing storeId fails before any HTTP call (store_id is required)', async () => {
      prisma.courierCredentials.findUnique.mockImplementation(() =>
        Promise.resolve(credsFor('carrybee', { storeId: null })),
      );
      mockFetchSequence([created201()]);

      const results = await manager.dispatch('carrybee', ['order-1']);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(results[0].ok).toBe(false);
      expect(results[0].message).toContain('store_id');
    });

    it('pads short addresses to the 10-char minimum instead of 422ing', async () => {
      prisma.order.findMany.mockResolvedValue([
        { ...order, shippingAddress: { address: 'Dhaka' } },
      ]);
      mockFetchSequence([created201()]);

      const results = await manager.dispatch('carrybee', ['order-1']);

      expect(results[0].ok).toBe(true);
      const body = sentBody();
      expect(String(body.recipient_address).length).toBeGreaterThanOrEqual(10);
    });

    it('item_weight defaults to 500g and clamps to 1..25000', async () => {
      mockFetchSequence([created201()]);
      await manager.dispatch('carrybee', ['order-1']);
      expect(sentBody().item_weight).toBe(500);

      prisma.order.findMany.mockResolvedValue([
        { ...order, items: [{ weightGram: 1200, product: { name: 'Item' } }] },
      ]);
      mockFetchSequence([created201()]);
      await manager.dispatch('carrybee', ['order-1']);
      expect(sentBody().item_weight).toBe(1200);

      prisma.order.findMany.mockResolvedValue([
        { ...order, items: [{ weightGram: 999999, product: { name: 'Item' } }] },
      ]);
      mockFetchSequence([created201()]);
      await manager.dispatch('carrybee', ['order-1']);
      expect(sentBody().item_weight).toBe(25000);
    });
  });

  describe('tracking GET /api/v2/orders/{id}/details', () => {
    function trackingHarness() {
      const cache: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
      };
      const trackingPrisma: any = {
        ...prisma,
        isRestoreWriteBlocked: jest.fn().mockResolvedValue(true),
        courierReportCache: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const tracking = new CourierTrackingService(
        trackingPrisma as any,
        cache as any,
        tokenStore as any,
      );
      return { tracking };
    }

    const detailsDoc = {
      error: false,
      message: 'Order details',
      data: {
        transfer_status: 'in-transit',
        store_id: 'store-abc-123',
        consignment_id: 'CBX-1',
        merchant_order_id: 'ORD-1',
        recipient_name: 'Karim Uddin',
        recipient_phone: '01712345678',
        recipient_secondary_phone: '',
        recipient_address: 'House 5, Road 3, Banani, Dhaka',
        collectable_amount: '500',
        collected_amount: '0',
        cod_fee: 15,
        delivery_fee: '60',
        attempt: 1,
        reason: '',
        invoice_id: '',
        payment_status: 'unpaid',
        updated_at: '2025-07-30T10:11:12+00:00',
      },
    };

    it('GETs the details endpoint with Client-* headers and maps transfer_status', async () => {
      mockFetchSequence([
        new Response(JSON.stringify(detailsDoc), { status: 200 }),
      ]);
      const { tracking } = trackingHarness();

      const result = await tracking.getDispatchTracking(
        'carrybee',
        '01712345678',
        'CBX-1',
        null,
        { force: true },
      );

      expect(result).not.toBeNull();
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toBe(
        'https://sandbox.carrybee.com/api/v2/orders/CBX-1/details',
      );
      expect(String(url)).not.toContain('api_key');
      expect(init.headers['Client-ID']).toBe('test-client-id');
      expect(init.headers['Client-Secret']).toBe('test-client-secret');
      expect(init.headers['Client-Context']).toBe('test-context');
      expect(result!.currentStatus).toBe('in-transit');
      expect(result!.events.length).toBeGreaterThan(0);
    });
  });

  describe('cancel POST /api/v2/orders/{id}/cancel', () => {
    it('posts cancellation_reason and accepts the doc 202 shape', async () => {
      mockFetchSequence([
        new Response(
          JSON.stringify({ error: false, message: 'Cancellation confirmed', data: null }),
          { status: 202 },
        ),
      ]);

      const result = await manager.cancelCarrybeeOrder(
        'CBX-1',
        'Customer asked to cancel',
      );

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toBe(
        'https://sandbox.carrybee.com/api/v2/orders/CBX-1/cancel',
      );
      expect(init.method).toBe('POST');
      expect(init.headers['Client-ID']).toBe('test-client-id');
      expect(JSON.parse(init.body)).toEqual({
        cancellation_reason: 'Customer asked to cancel',
      });
      expect(result.success).toBe(true);
    });

    it('refuses to call without a reason (doc: required, <200 chars)', async () => {
      global.fetch = jest.fn();
      await expect(manager.cancelCarrybeeOrder('CBX-1', '')).rejects.toThrow();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('details client', () => {
    it('getCarrybeeOrderDetails returns the doc data object', async () => {
      const data = {
        transfer_status: 'delivered',
        consignment_id: 'CBX-1',
        merchant_order_id: 'ORD-1',
        collected_amount: '500',
        attempt: 1,
        updated_at: '2025-07-30T10:11:12+00:00',
      };
      mockFetchSequence([
        new Response(JSON.stringify({ error: false, message: 'Order details', data }), {
          status: 200,
        }),
      ]);

      const result = await manager.getCarrybeeOrderDetails('CBX-1');

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toBe(
        'https://sandbox.carrybee.com/api/v2/orders/CBX-1/details',
      );
      expect(init.headers['Client-ID']).toBe('test-client-id');
      expect(result).toMatchObject({ consignment_id: 'CBX-1' });
    });
  });

  describe('webhook failed-event handling (no cancel inference)', () => {
    let webhook: CourierWebhookService;
    let ordersService: any;
    const cbOrder = {
      id: 'order-1',
      status: { id: 'status-shipping', name: 'Shipping' },
      courierStatus: 'shipping',
      courierTrackingCode: null,
      courierConsignmentId: 'CBX-1',
      displayId: 'ORD-1',
      courierService: 'carrybee',
      trashedAt: null,
    };

    beforeEach(async () => {
      prisma.order.findFirst.mockResolvedValue(cbOrder);
      prisma.order.findUnique.mockResolvedValue(cbOrder);
      ordersService = { updateStatus: jest.fn().mockResolvedValue({}) };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CourierWebhookService,
          { provide: PrismaService, useValue: prisma },
          { provide: OrdersService, useValue: ordersService },
          {
            provide: CourierManagerService,
            useValue: { getSteadfastReturnStatus: jest.fn() },
          },
          {
            provide: CancelReturnStockService,
            useValue: { restoreForOrder: jest.fn() },
          },
        ],
      }).compile();
      webhook = module.get<CourierWebhookService>(CourierWebhookService);
    });

    it('order.delivery-failed records attempt+reason+remarks with NO state change', async () => {
      const result = await webhook.handleCarrybee({
        event: 'order.delivery-failed',
        consignment_id: 'CBX-1',
        merchant_order_id: 'ORD-1',
        attempt: 2,
        reason: 'Customer not reachable',
        remarks: 'Gate closed',
      });

      expect(result.status).toBe('success');
      // Raw courier state recorded…
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({
            courierStatus: 'order.delivery-failed',
            courierService: 'carrybee',
          }),
        }),
      );
      // …timeline carries attempt/reason/remarks…
      const timelineWrite = prisma.order.update.mock.calls.find(
        (c: any) => c[0]?.data?.timeline,
      );
      const notes = JSON.stringify(timelineWrite[0].data.timeline);
      expect(notes).toContain('Customer not reachable');
      expect(notes).toContain('Gate closed');
      expect(notes).toContain('2');
      // …but NO dispatch status write and NO order advancement.
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });

    // Task 3 (owner-locked F7): pickup-failed is a real PICKUP_FAILED
    // workflow state (record attempt + reason, order Shipping) — staff can
    // retry/update the same dispatch. delivery-failed stays record-only.
    it('order.pickup-failed upserts PICKUP_FAILED + advances the order to Shipping', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...cbOrder,
        status: { id: 'status-packed', name: 'Packed' },
        timeline: [],
      });
      prisma.order.findUnique.mockResolvedValue({
        ...cbOrder,
        status: { id: 'status-packed', name: 'Packed' },
      });
      (prisma as any).orderStatus = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'status-shipping',
          name: 'Shipping',
        }),
      };

      const result = await webhook.handleCarrybee({
        event: 'order.pickup-failed',
        consignment_id: 'CBX-1',
        merchant_order_id: 'ORD-1',
        attempt: 1,
        reason: 'Shop closed at pickup time',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PICKUP_FAILED' }),
        }),
      );
      const timelineWrite = prisma.order.update.mock.calls.find(
        (c: any) => c[0]?.data?.timeline,
      );
      const notes = JSON.stringify(timelineWrite[0].data.timeline);
      expect(notes).toContain('Shop closed at pickup time');
      expect(notes).toContain('1');
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-shipping' },
        'system',
      );
    });

    it('falls back to merchant_order_id → displayId when the consignment is unknown', async () => {
      prisma.order.findFirst
        .mockResolvedValueOnce(null) // courierConsignmentId miss
        .mockResolvedValueOnce(cbOrder); // merchant_order_id → displayId hit
      prisma.dispatch.findFirst.mockResolvedValue(null);
      prisma.orderStatus = { findUnique: jest.fn().mockResolvedValue(null) };

      const result = await webhook.handleCarrybee({
        event: 'order.delivered',
        consignment_id: 'PORTAL-BOOKED-9',
        merchant_order_id: 'ORD-1',
        collected_amount: 500,
        attempt: 1,
      });

      expect(result.status).toBe('success');
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            displayId: 'ORD-1',
            courierService: 'carrybee',
          }),
        }),
      );
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });

    it('keeps the webhook_integration branch', async () => {
      const result = await webhook.handleCarrybee({
        event: 'webhook_integration',
      });
      expect(result.status).toBe('success');
    });
  });
});
