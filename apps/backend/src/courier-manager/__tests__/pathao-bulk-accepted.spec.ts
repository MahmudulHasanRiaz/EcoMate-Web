import { Test } from '@nestjs/testing';
import { CourierManagerService } from '../courier-manager.service';
import { CourierWebhookService } from '../courier-webhook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';

/**
 * Review MAJOR: Pathao bulk returns 202 with NO per-order ids — the old code
 * returned the internal order.id (useless handle), created no local rows, and
 * webhooks couldn't complete anything visible → silent stuck-accepted.
 *
 * Fixed contract:
 *  (1) bulk 202 creates one local Dispatch row per entry (orderId +
 *      courier=pathao + NULL consignmentId + merchant ref displayId in notes,
 *      manual-row pattern) and stamps Order.courierService so the
 *      merchant_order_id → displayId webhook fallback resolves;
 *  (2) result entries carry merchant_order_id/displayId + 'accepted,
 *      processing' (never the internal id alone);
 *  (3) top-level message points at the dispatch list (no fake
 *      "verify via order info" without an ID);
 *  (4) end-to-end at mock level: bulk 202 → NULL rows → simulated
 *      order.created webhook {merchant_order_id} → row filled, no duplicate.
 */
describe('Pathao bulk accepted-rows + webhook completion', () => {
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

  const mkOrder = (id: string, displayId: string): any => ({
    id,
    displayId,
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
    shippingAddress: {
      address: 'House 1, Road 2, Dhaka',
      district: 'Dhaka',
      deliveryType: 'home',
    },
    customer: { name: 'Test', phone: '01712345678', email: null },
    items: [{ product: { name: 'Item' }, price: 500 }],
  });

  const acceptedFetch = () =>
    jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message:
            'Your bulk order creation request is accepted, please wait some time to complete order creation.',
          type: 'success',
          code: 202,
          data: true,
        }),
        { status: 202 },
      ),
    );

  function bulkPrisma(orders: any[]) {
    return {
      courierCredentials: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(credsFor(where.courier)),
        ),
      },
      order: {
        findMany: jest.fn().mockResolvedValue(orders),
        findUnique: jest.fn().mockResolvedValue({ timeline: [] }),
        findFirst: jest.fn().mockResolvedValue({ id: orders[0]?.id }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: orders.length }),
      },
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: `d-${data.orderId}`, ...data }),
        ),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
  }

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('creates one accepted Dispatch row per order (NULL consignment, merchant ref = displayId)', async () => {
    const orders = [mkOrder('order-1', 'ORD-1'), mkOrder('order-2', 'ORD-2')];
    const prisma: any = bulkPrisma(orders);
    const service = new CourierManagerService(prisma as any, tokenStore as any);
    global.fetch = acceptedFetch();

    await service.bulkCreatePathaoOrders(orders);

    expect(prisma.dispatch.create).toHaveBeenCalledTimes(2);
    for (const [i, o] of orders.entries()) {
      const data = prisma.dispatch.create.mock.calls[i][0].data;
      expect(data.orderId).toBe(o.id);
      expect(String(data.courier)).toBe('pathao');
      expect(data.consignmentId ?? null).toBeNull();
      // Merchant ref: the staff-actionable handle (displayId) rides the row.
      expect(JSON.stringify(data)).toContain(o.displayId);
    }
  });

  it('stamps Order.courierService so the merchant_order_id webhook fallback resolves', async () => {
    const orders = [mkOrder('order-1', 'ORD-1')];
    const prisma: any = bulkPrisma(orders);
    const service = new CourierManagerService(prisma as any, tokenStore as any);
    global.fetch = acceptedFetch();

    await service.bulkCreatePathaoOrders(orders);

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courierService: 'pathao' }),
      }),
    );
  });

  it("result entries carry merchant_order_id/displayId + 'accepted, processing' (never internal id alone)", async () => {
    const orders = [mkOrder('order-1', 'ORD-1'), mkOrder('order-2', 'ORD-2')];
    const prisma: any = bulkPrisma(orders);
    const service = new CourierManagerService(prisma as any, tokenStore as any);
    global.fetch = acceptedFetch();

    const res: any = await service.bulkCreatePathaoOrders(orders);

    expect(res.results).toHaveLength(2);
    for (const [i, entry] of res.results.entries()) {
      expect(entry.ok).toBe(true);
      expect(entry.accepted).toBe(true);
      expect(entry.merchant_order_id).toBe(orders[i].displayId);
      expect(entry.displayId).toBe(orders[i].displayId);
      expect(String(entry.message)).toMatch(/accepted.*processing/i);
      // The actionable handle must be present — internal id alone is useless.
      expect(JSON.stringify(entry)).toContain(orders[i].displayId);
    }
  });

  it('top-level message points at the dispatch list, never a fake order-info verify', async () => {
    const orders = [mkOrder('order-1', 'ORD-1')];
    const prisma: any = bulkPrisma(orders);
    const service = new CourierManagerService(prisma as any, tokenStore as any);
    global.fetch = acceptedFetch();

    const res: any = await service.bulkCreatePathaoOrders(orders);

    expect(String(res.message)).toMatch(/accepted/i);
    expect(String(res.message)).toMatch(/dispatch list/i);
    expect(String(res.message)).not.toMatch(/verify via order info/i);
  });

  it('e2e at mock level: bulk 202 → NULL rows → order.created webhook fills consignment, no duplicate row', async () => {
    // Shared in-memory store behind ONE mock prisma for both services.
    const db = {
      orders: [
        {
          id: 'order-1',
          displayId: 'ORD-1',
          courierService: null as string | null,
          courierConsignmentId: null as string | null,
          timeline: [] as unknown[],
          status: { id: 'status-packed', name: 'Packed' },
        },
      ],
      dispatches: [] as any[],
    };
    const prisma: any = {
      courierCredentials: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(credsFor(where.courier)),
        ),
      },
      order: {
        findMany: jest.fn().mockImplementation(() => Promise.resolve([mkOrder('order-1', 'ORD-1')])),
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(db.orders.find((o) => o.id === where.id) ?? null),
        ),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.courierConsignmentId) {
            return Promise.resolve(
              db.orders.find((o) => o.courierConsignmentId === where.courierConsignmentId) ?? null,
            );
          }
          if (where?.displayId) {
            return Promise.resolve(
              db.orders.find(
                (o) => o.displayId === where.displayId && o.courierService === where.courierService,
              ) ?? null,
            );
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const row = db.orders.find((o) => o.id === where.id);
          if (row) Object.assign(row, data);
          return Promise.resolve(row);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
          const ids = Array.isArray(where?.id?.in)
            ? where.id.in
            : where?.id !== undefined
              ? [where.id]
              : null;
          let count = 0;
          for (const row of db.orders) {
            if (ids && !ids.includes(row.id)) continue;
            if (where?.courierConsignmentId !== undefined && row.courierConsignmentId !== where.courierConsignmentId)
              continue;
            if (where?.courierService !== undefined && row.courierService !== where.courierService)
              continue;
            Object.assign(row, data);
            count++;
          }
          return Promise.resolve({ count });
        }),
      },
      orderStatus: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve({ id: `status-${where.name}`, name: where.name }),
        ),
      },
      dispatch: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          const ids = Array.isArray(where?.orderId?.in)
            ? where.orderId.in
            : where?.orderId
              ? [where.orderId]
              : null;
          return Promise.resolve(
            db.dispatches.filter((d) => (ids ? ids.includes(d.orderId) : true)),
          );
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.courier && where?.consignmentId !== undefined && !where?.orderId) {
            // Owned-row check: exact courier+consignment match.
            return Promise.resolve(
              db.dispatches.find((d) => d.courier === where.courier && d.consignmentId === where.consignmentId) ??
                null,
            );
          }
          if (where?.orderId) {
            // Manual-row lookup: NULL-identifier row for the order+courier.
            return Promise.resolve(
              db.dispatches.find(
                (d) =>
                  d.orderId === where.orderId &&
                  d.courier === where.courier &&
                  (d.consignmentId === null || d.consignmentId === undefined),
              ) ?? null,
            );
          }
          return Promise.resolve(null);
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = { id: `d-${data.orderId}-${db.dispatches.length}`, ...data };
          db.dispatches.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const row = db.dispatches.find((d) => d.id === where.id);
          if (row) Object.assign(row, data);
          return Promise.resolve(row);
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockImplementation(({ where, update, create }: any) => {
          const key = where?.courier_consignmentId;
          const owned = db.dispatches.find(
            (d) => d.courier === key?.courier && d.consignmentId === key?.consignmentId,
          );
          if (owned) {
            Object.assign(owned, update);
            return Promise.resolve(owned);
          }
          const row = { id: `d-upsert-${db.dispatches.length}`, ...create };
          db.dispatches.push(row);
          return Promise.resolve(row);
        }),
      },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const ordersService: any = { updateStatus: jest.fn().mockResolvedValue({}) };
    const manager = new CourierManagerService(prisma as any, tokenStore as any);
    const module = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: CourierManagerService, useValue: { getSteadfastReturnStatus: jest.fn() } },
        {
          provide: CancelReturnStockService,
          useValue: { restoreForOrder: jest.fn() },
        },
      ],
    }).compile();
    const webhooks = module.get<CourierWebhookService>(CourierWebhookService);

    global.fetch = acceptedFetch();
    const bulk: any = await manager.bulkCreatePathaoOrders([mkOrder('order-1', 'ORD-1')]);
    expect(bulk.accepted).toBe(true);

    // Accepted rows exist with NULL consignment.
    expect(db.dispatches).toHaveLength(1);
    expect(db.dispatches[0].orderId).toBe('order-1');
    expect(db.dispatches[0].consignmentId ?? null).toBeNull();
    // Order stamped so the merchant_order_id fallback can resolve.
    expect(db.orders[0].courierService).toBe('pathao');

    // Simulated async completion: order.created carries the consignment +
    // the merchant ref. The NULL row must be filled — no duplicate row.
    const result = await webhooks.handlePathao({
      event: 'order.created',
      consignment_id: 'PH-BULK-1',
      merchant_order_id: 'ORD-1',
    });
    expect(result.status).toBe('success');
    expect(db.dispatches).toHaveLength(1);
    expect(db.dispatches[0].consignmentId).toBe('PH-BULK-1');
  });
});
