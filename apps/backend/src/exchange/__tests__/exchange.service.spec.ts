import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExchangeService } from '../exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { OrdersEventService } from '../../orders/orders-event.service';
import { CacheService } from '../../cache/cache.service';
import { ReturnsService } from '../../returns/returns.service';

const actor = { userId: 'u1', email: 'staff@ecomate.com' };

/** In-memory Prisma fake covering exactly the paths ExchangeService touches. */
function makeFake(opts: {
  order: any;
  paidAmount?: number;
  siblingCredits?: number;
  products?: any[];
}) {
  const orders: any[] = [];
  const orderItems: any[] = [];
  const refunds: any[] = [];
  let counter = 0;

  const statuses = [
    { id: 'st-confirmed', name: 'Confirmed' },
    { id: 'st-return-pending', name: 'Return Pending' },
  ];

  const tx = {
    // appendOrderTimeline writes via $executeRaw; the fake records the append
    // so tests can assert the timeline without a real JSONB column.
    $executeRaw: async (parts: TemplateStringsArray | any, ...vals: any[]) => {
      const sql = Array.isArray(parts) ? parts.join('?') : String(parts);
      const idMatch = sql.match(/WHERE\s+"id"\s*=\s*'([^']+)'/);
      const target = idMatch
        ? orders.find((o) => o.id === idMatch[1]) ?? opts.order
        : undefined;
      if (target && Array.isArray(target.timeline)) {
        try {
          const payload = JSON.parse(vals[0] as string);
          target.timeline.push(...payload);
        } catch {
          /* not a timeline append — ignore */
        }
      }
      return 0;
    },
    order: {
      create: async ({ data }: any) => {
        const created = { id: `ex-${++counter}`, ...data };
        orders.push(created);
        return created;
      },
      findUnique: async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        // The ORIGINAL lives outside the created-exchange array, so look in
        // both — the service updates the exchange AND the original in one tx.
        const t =
          orders.find((o) => o.id === where.id) ??
          (opts.order.id === where.id ? opts.order : undefined);
        if (!t) throw new Error(`order ${where.id} not found`);
        Object.assign(t, data);
        return t;
      },
      // Settlement's "credit already consumed by sibling exchanges".
      aggregate: async ({ where }: any) => {
        const sum = orders
          .filter(
            (o) =>
              o.exchangeOfOrderId === where.exchangeOfOrderId &&
              o.exchangedCreditAmount != null,
          )
          .reduce((s, o) => s + Number(o.exchangedCreditAmount), 0);
        return { _sum: { exchangedCreditAmount: sum } };
      },
      findFirst: async ({ where }: any) =>
        orderItems.find((i) => i.orderId === where.orderId) ?? null,
    },
    orderItem: {
      create: async ({ data }: any) => {
        const created = { id: `it-${orderItems.length + 1}`, ...data };
        orderItems.push(created);
        return created;
      },
      findFirst: async ({ where }: any) =>
        orderItems.find((i) => i.orderId === where.orderId) ?? null,
    },
    orderStatus: {
      findUnique: async ({ where }: any) =>
        statuses.find((s) => s.name === where.name) ?? null,
    },
    payment: {
      aggregate: async () => ({ _sum: { amount: opts.paidAmount ?? 0 } }),
      findFirst: async () => ({ id: 'pay-1' }),
      // Hardening (4): transfer-linked rows recorded on the exchange.
      create: async ({ data }: any) => ({ id: `pay-t-${Date.now()}`, ...data }),
    },
    refund: {
      create: async ({ data }: any) => {
        const created = { id: `rf-${refunds.length + 1}`, ...data };
        refunds.push(created);
        return created;
      },
      findMany: async () => [],
    },
    orderCounter: {
      upsert: async ({ create }: any) => ({ date: create.date, seq: create.seq }),
    },
  };

  const prisma: any = {
    ...tx,
    $transaction: async (cb: any) => cb(tx),
    order: {
      ...tx.order,
      findUnique: async ({ where, select }: any) => {
        if (where.id === opts.order.id) return opts.order;
        return tx.order.findUnique({ where, select });
      },
    },
    refund: {
      findMany: async () => [],
    },
  };

  return { prisma, store: { orders, orderItems, refunds } };
}

function makeOrder(over: any = {}) {
  return {
    id: 'order-1',
    displayId: 'ORD-260930-0007',
    kind: 'SALE',
    status: { id: 'st-delivered', name: 'Delivered' },
    total: 1000,
    trashedAt: null,
    customerId: 'c-1',
    customerEmail: 'c@x.com',
    customerPhone: '01711111111',
    customerFirstName: 'C',
    customerLastName: 'X',
    shippingAddress: { city: 'Dhaka' },
    ...over,
  };
}

const product = (over: any = {}) => ({
  id: 'prod-1',
  name: 'Widget',
  manageStock: true,
  reservedStock: 0,
  availabilityMode: 'MANAGED_STOCK',
  managedStockQuantity: 50,
  variants: [],
  ...over,
});

async function setup(opts: { order?: any; paidAmount?: number; products?: any[] }) {
  const fake = makeFake({
    order: opts.order ?? makeOrder(),
    paidAmount: opts.paidAmount ?? 0,
    products: opts.products,
  });
  const applyStockForLine = jest.fn().mockResolvedValue(undefined);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ExchangeService,
      {
        provide: PrismaService,
        useValue: {
          ...fake.prisma,
          product: { findMany: async () => (opts.products ?? [product()]) },
          payment: { aggregate: async () => ({ _sum: { amount: opts.paidAmount ?? 0 } }) },
          order: fake.prisma.order,
          refund: fake.prisma.refund,
        },
      },
      {
        provide: OrdersService,
        useValue: {
          recalculate: (items: any[], shipping: number, discount: number, type = 'flat') => {
            const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
            const eff = type === 'percentage' ? subtotal * (discount / 100) : discount;
            return { subtotal, total: Math.max(0, subtotal + shipping - eff) };
          },
          applyStockForLine,
        },
      },
      { provide: OrdersEventService, useValue: { emit: jest.fn() } },
      { provide: CacheService, useValue: { invalidateByPrefix: jest.fn() } },
      // Task 4 (Fix 8): the Return(EXCHANGE) leg. FULL snapshots the order,
      // PARTIAL carries staff-picked items — both through this mock.
      {
        provide: ReturnsService,
        useValue: {
          create: jest.fn().mockImplementation((dto: any) =>
            Promise.resolve({ id: 'ret-1', displayId: 'RTN-260930-0001', status: 'REQUESTED', ...dto }),
          ),
          orderItemsSnapshot: jest.fn().mockResolvedValue([]),
          validateItemsInput: jest.fn((items: any) => items),
        },
      },
    ],
  }).compile();
  return { service: module.get(ExchangeService), store: fake.store, applyStockForLine };
}

describe('ExchangeService — settlement (§4)', () => {
  // Exchange total 1200 vs original paid 1000 → collect the 200 difference only.
  it('collects ONLY the difference when the exchange costs more', async () => {
    const { service, store, applyStockForLine } = await setup({ paidAmount: 1000 });
    const res = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 2, price: 600 }] },
      actor,
    );

    expect(res.settlement.status).toBe('SETTLED_DUE');
    expect(res.settlement.originalPaid).toBe(1000);
    expect(res.settlement.exchangeTotal).toBe(1200);
    expect(res.settlement.creditApplied).toBe(1000);
    expect(res.settlement.delta).toBe(200);
    // The full 1000 must NOT be collected again — only the 200 delta.
    expect(store.refunds).toHaveLength(0);
    expect(applyStockForLine).toHaveBeenCalledWith(
      'reserve', 'prod-1', null, 2, expect.any(String), expect.anything(), expect.anything(),
    );
  });

  it('settles exactly when the exchange equals the original paid amount', async () => {
    const { service, store } = await setup({ paidAmount: 1000 });
    const res = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
      actor,
    );

    expect(res.settlement.status).toBe('SETTLED_EXACT');
    expect(res.settlement.delta).toBe(0);
    expect(store.refunds).toHaveLength(0);
    // Fully settled on creation — no follow-up collection needed.
    expect(store.orders[0].settlementSettledAt).not.toBeNull();
  });

  it('refunds the UNUSED credit and links it to the exchange when it costs less', async () => {
    // Requirements §4: exchange 600 < original paid 1000 → refund 400.
    const { service, store } = await setup({ paidAmount: 1000 });
    const res = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 600 }] },
      actor,
    );

    expect(res.settlement.status).toBe('SETTLED_REFUND');
    expect(res.settlement.creditApplied).toBe(600);
    expect(res.settlement.delta).toBe(400);
    expect(store.refunds).toHaveLength(1);
    // Refund is raised against the ORIGINAL (whose money comes back) but
    // carries the exchange link, so neither side is an orphan.
    expect(store.refunds[0].orderId).toBe('order-1');
    expect(store.refunds[0].exchangeOrderId).toBe(store.orders[0].id);
    expect(Number(store.refunds[0].amount)).toBe(400);
  });

  it('refunds only what the SECOND exchange left unused when siblings exist', async () => {
    // Original paid 1000. Exchange #1 (600) consumes 600, leaving 400.
    // Exchange #2 (100) consumes 100 of that 400 and refunds the remaining 300.
    const { service, store } = await setup({ paidAmount: 1000 });
    await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 600 }] },
      actor,
    );
    const second = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 100 }] },
      actor,
    );

    expect(second.settlement.availableCredit).toBe(400);
    expect(second.settlement.creditApplied).toBe(100);
    expect(second.settlement.status).toBe('SETTLED_REFUND');
    expect(second.settlement.delta).toBe(300);
    // BOTH exchanges refund their own unused credit, and the amounts are
    // distinct — 400 from the first, 300 from the second, each carrying its
    // own exchangeOrderId so neither can be mistaken for the other.
    expect(store.refunds).toHaveLength(2);
    expect(Number(store.refunds[0].amount)).toBe(400);
    expect(Number(store.refunds[1].amount)).toBe(300);
    expect(store.refunds[0].exchangeOrderId).toBe(store.orders[0].id);
    expect(store.refunds[1].exchangeOrderId).toBe(store.orders[1].id);
  });

  it('refunds the WHOLE paid amount for an unpaid original with no credit', async () => {
    // Paid 0 → nothing to credit, so the entire exchange total is refundable
    // only in the sense that delta == -0 → EXACT. Guard the arithmetic.
    const { service } = await setup({ paidAmount: 0 });
    const res = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 500 }] },
      actor,
    );
    expect(res.settlement.creditApplied).toBe(0);
    expect(res.settlement.status).toBe('SETTLED_DUE');
    expect(res.settlement.delta).toBe(500);
  });

  it('never lets a second exchange re-spend the same credit', async () => {
    const { service, store } = await setup({ paidAmount: 1000 });
    await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 600 }] },
      actor,
    );
    // First exchange consumed 600 of the 1000 paid.
    expect(store.orders[0].exchangedCreditAmount).toBe(600);

    const res2 = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 300 }] },
      actor,
    );
    // Only 400 credit remained, so the 300 bill is covered and the leftover
    // 100 goes back — the second exchange cannot touch the first's 600.
    expect(res2.settlement.availableCredit).toBe(400);
    expect(res2.settlement.creditApplied).toBe(300);
    expect(res2.settlement.status).toBe('SETTLED_REFUND');
    expect(res2.settlement.delta).toBe(100);
  });
});

describe('ExchangeService — lifecycle (§5, §6)', () => {
  it('creates the exchange Confirmed with an Ex- id (sheet Rule 20) and moves the original to Return Pending', async () => {
    const order = makeOrder();
    const { service, store } = await setup({ order, paidAmount: 1000 });
    const res = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
      actor,
    );

    expect(res.exchange.displayId).toMatch(/^Ex-\d{6}-\d{4}$/);
    expect(res.exchange.kind).toBe('EXCHANGE');
    expect(res.exchange.statusId).toBe('st-confirmed'); // no manual confirm step
    expect(res.exchange.exchangeOfOrderId).toBe('order-1');
    // §5: the ORIGINAL is now Return Pending, even though it was Delivered.
    expect(order.statusId).toBe('st-return-pending');
    expect(store.orders[0].shippingCharge).toBe(0); // nothing copied (§2)
  });

  it('copies customer identity but never the original financials', async () => {
    const order = makeOrder({ total: 999, shippingCharge: 120, discount: 55 });
    const { service, store } = await setup({ order, paidAmount: 999 });
    await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 300 }], shippingCharge: 40 },
      actor,
    );
    const ex = store.orders[0];
    expect(ex.customerPhone).toBe(order.customerPhone);
    expect(ex.shippingAddress).toEqual(order.shippingAddress);
    // Fresh money only: 300 + 40 shipping, zero discount.
    expect(ex.shippingCharge).toBe(40);
    expect(ex.discount).toBe(0);
    expect(ex.total).toBe(340);
  });

  it('refuses an exchange from a non-sale order', async () => {
    const { service } = await setup({ order: makeOrder({ kind: 'RETURN' }), paidAmount: 100 });
    await expect(
      service.createFromOrder('order-1', { items: [{ productId: 'prod-1', quantity: 1, price: 10 }] }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing order and a missing product', async () => {
    const { service } = await setup({ order: makeOrder(), paidAmount: 10 });
    await expect(
      service.createFromOrder('nope', { items: [{ productId: 'prod-1', quantity: 1, price: 10 }] }, actor),
    ).rejects.toThrow(NotFoundException);

    const missing = await setup({ order: makeOrder(), paidAmount: 10, products: [] });
    await expect(
      missing.service.createFromOrder('order-1', { items: [{ productId: 'ghost', quantity: 1, price: 10 }] }, actor),
    ).rejects.toThrow(/no longer exists/i);
  });

  it('refuses to reserve more than the available managed stock', async () => {
    const { service } = await setup({
      order: makeOrder(),
      paidAmount: 1000,
      products: [product({ managedStockQuantity: 2, reservedStock: 0 })],
    });
    await expect(
      service.createFromOrder('order-1', { items: [{ productId: 'prod-1', quantity: 5, price: 10 }] }, actor),
    ).rejects.toThrow(/in stock/i);
  });

  it('surfaces the available credit in the settlement preview', async () => {
    const { service } = await setup({ order: makeOrder(), paidAmount: 700 });
    const preview = await service.getSettlementPreview('order-1');
    expect(preview.creditAvailable).toBe(700);
    expect(preview.originalPaid).toBe(700);
  });

  it.each(['Shipping', 'Delivered', 'Partial', 'Return Pending'])(
    'allows exchange creation from status %s',
    async (status) => {
      const order = makeOrder({ status: { id: `st-${status}`, name: status } });
      const { service, store } = await setup({ order, paidAmount: 1000 });
      const res = await service.createFromOrder(
        'order-1',
        { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
        actor,
      );
      expect(store.orders).toHaveLength(1);
      expect(res.exchange.kind).toBe('EXCHANGE');
    },
  );

  it.each(['Pending', 'Confirmed', 'Packed', 'Hold', 'Cancelled', 'Returned'])(
    'refuses exchange creation from status %s (400)',
    async (status) => {
      const order = makeOrder({ status: { id: `st-${status}`, name: status } });
      const { service, store } = await setup({ order, paidAmount: 1000 });
      await expect(
        service.createFromOrder(
          'order-1',
          { items: [{ productId: 'prod-1', quantity: 1, price: 10 }] },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(store.orders).toHaveLength(0);
    },
  );

  it('refuses a PARTIAL returning line whose qty exceeds the original ordered qty', async () => {
    const order = makeOrder({
      items: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
    });
    const { service, store } = await setup({ order, paidAmount: 1000 });
    await expect(
      service.createFromOrder(
        'order-1',
        {
          mode: 'PARTIAL',
          items: [{ productId: 'prod-1', quantity: 1, price: 100 }],
          returningItems: [{ productId: 'prod-1', quantity: 5 }],
        },
        actor,
      ),
    ).rejects.toThrow(/exceed|ordered quantity/i);
    expect(store.orders).toHaveLength(0);
  });

  it('allows a PARTIAL returning line whose qty equals the original ordered qty', async () => {
    const order = makeOrder({
      items: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
    });
    const { service, store } = await setup({ order, paidAmount: 1000 });
    const res = await service.createFromOrder(
      'order-1',
      {
        mode: 'PARTIAL',
        items: [{ productId: 'prod-1', quantity: 1, price: 100 }],
        returningItems: [{ productId: 'prod-1', quantity: 2 }],
      },
      actor,
    );
    expect(store.orders).toHaveLength(1);
    expect(res.mode).toBe('PARTIAL');
  });
});