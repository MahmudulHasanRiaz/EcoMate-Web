import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ExchangeService } from '../exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { OrdersEventService } from '../../orders/orders-event.service';
import { CacheService } from '../../cache/cache.service';
import { ReturnsService } from '../../returns/returns.service';

/**
 * Task 4 (Fix 8): exchange FULL vs PARTIAL + both-signals Returned gate.
 *
 * OWNER-LOCKED modeling: returns are Return records, NOT Orders.
 * - FULL: ONE new exchange order + ONE Return(EXCHANGE, full snapshot).
 * - PARTIAL: exchange order + Return(EXCHANGE, staff-picked items) — TWO
 *   records at once, still exactly ONE new Order (no phantom Orders).
 * - Original → Returned ONLY on exchange-delivered AND return-arrived
 *   (readiness check); NEVER auto from an exchange event alone.
 */
const actor = { userId: 'u1', email: 'staff@ecomate.com' };

function makeFake(opts: {
  order: any;
  paidAmount?: number;
  products?: any[];
  dispatches?: any[];
  exReturns?: any[];
}) {
  const orders: any[] = [];
  const orderItems: any[] = [];
  const refunds: any[] = [];
  let counter = 0;

  const statuses = [
    { id: 'st-confirmed', name: 'Confirmed' },
    { id: 'st-return-pending', name: 'Return Pending' },
  ];

  const tx: any = {
    $executeRaw: async () => 0,
    order: {
      create: async ({ data }: any) => {
        const created = { id: `ex-${++counter}`, ...data };
        orders.push(created);
        return created;
      },
      findUnique: async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const t =
          orders.find((o) => o.id === where.id) ??
          (opts.order.id === where.id ? opts.order : undefined);
        if (!t) throw new Error(`order ${where.id} not found`);
        Object.assign(t, data);
        return t;
      },
      aggregate: async () => ({ _sum: { exchangedCreditAmount: 0 } }),
      findFirst: async () => orderItems[0] ?? null,
      findMany: async () => [],
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
      findUnique: async ({ where }: any) => {
        if (where.id === opts.order.id) return opts.order;
        return tx.order.findUnique({ where });
      },
    },
    refund: { findMany: async () => [] },
    dispatch: { findMany: async () => opts.dispatches ?? [] },
    return: { findMany: async () => opts.exReturns ?? [] },
  };

  return { prisma, tx, store: { orders, orderItems, refunds } };
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
    items: [
      { id: 'oi-1', productId: 'prod-1', variantId: null, quantity: 2, price: 500 },
    ],
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

async function setup(opts: {
  order?: any;
  paidAmount?: number;
  products?: any[];
  dispatches?: any[];
  exReturns?: any[];
}) {
  const fake = makeFake({
    order: opts.order ?? makeOrder(),
    paidAmount: opts.paidAmount ?? 0,
    products: opts.products,
    dispatches: opts.dispatches,
    exReturns: opts.exReturns,
  });
  const applyStockForLine = jest.fn().mockResolvedValue(undefined);
  const returnsCreate = jest.fn().mockImplementation((dto: any) =>
    Promise.resolve({ id: 'ret-1', displayId: 'RTN-260930-0001', status: 'REQUESTED', ...dto }),
  );
  const returnsSnapshot = jest.fn().mockResolvedValue([
    { productId: 'prod-1', variantId: null, quantity: 2 },
  ]);
  // Shape-check mirrors ReturnsService.validateItemsInput (positive-int qty,
  // no dupes) so the PARTIAL validation path is exercised, not bypassed.
  const returnsValidate = jest.fn((items: any[]) => {
    const { BadRequestException: BRE } = require('@nestjs/common');
    if (!Array.isArray(items)) throw new BRE('Return items must be an array');
    const seen = new Set<string>();
    return items.map((it: any, i: number) => {
      const productId = String(it?.productId ?? '').trim();
      const variantId = it?.variantId ? String(it.variantId) : null;
      const quantity = Number(it?.quantity);
      if (!productId) throw new BRE(`Return items[${i}].productId is required`);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BRE(`Return items[${i}].quantity must be a positive integer`);
      }
      const key = `${productId}::${variantId ?? ''}`;
      if (seen.has(key)) throw new BRE(`Duplicate return line: ${productId}`);
      seen.add(key);
      return { productId, variantId, quantity };
    });
  });
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
      {
        provide: ReturnsService,
        useValue: { create: returnsCreate, orderItemsSnapshot: returnsSnapshot, validateItemsInput: returnsValidate },
      },
    ],
  }).compile();
  return {
    service: module.get(ExchangeService),
    store: fake.store,
    tx: fake.tx,
    returnsCreate,
    returnsSnapshot,
  };
}

describe('ExchangeService — Full vs Partial (Task 4 Fix 8)', () => {
  it('FULL creates ONE exchange order + ONE Return(EXCHANGE) with the full snapshot', async () => {
    const order = makeOrder();
    const { service, store, returnsCreate, returnsSnapshot } = await setup({ order });
    const res = await service.createFromOrder(
      'order-1',
      { mode: 'FULL', items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
      actor,
    );

    // Exactly ONE new Order (the exchange) — the return leg is a Return
    // record, never a phantom Order.
    expect(store.orders).toHaveLength(1);
    expect(store.orders[0].kind).toBe('EXCHANGE');
    expect(returnsSnapshot).toHaveBeenCalledWith('order-1');
    expect(returnsCreate).toHaveBeenCalledTimes(1);
    expect(returnsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        type: 'EXCHANGE',
        source: 'EXCHANGE',
        items: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
        exchangeOrderId: store.orders[0].id,
      }),
      actor.email,
      expect.anything(),
    );
    expect(res.mode).toBe('FULL');
    expect(res.returnRecord).toMatchObject({ id: 'ret-1' });
    // Original waits for BOTH signals — Return Pending, never Returned.
    expect(order.statusId).toBe('st-return-pending');
  });

  it('defaults to FULL when mode is absent (backward compatible)', async () => {
    const { service, store, returnsCreate } = await setup({});
    const res = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
      actor,
    );
    expect(store.orders).toHaveLength(1);
    expect(returnsCreate).toHaveBeenCalledTimes(1);
    expect(res.mode).toBe('FULL');
  });

  it('PARTIAL requires staff-picked returning items (400s, creates nothing)', async () => {
    const { service, store, returnsCreate } = await setup({});
    await expect(
      service.createFromOrder(
        'order-1',
        { mode: 'PARTIAL', items: [{ productId: 'prod-1', quantity: 1, price: 100 }] },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.orders).toHaveLength(0);
    expect(returnsCreate).not.toHaveBeenCalled();
  });

  it('PARTIAL creates the exchange order + Return(EXCHANGE) with picked items at once', async () => {
    const order = makeOrder();
    const { service, store, returnsCreate } = await setup({ order });
    const res = await service.createFromOrder(
      'order-1',
      {
        mode: 'PARTIAL',
        items: [{ productId: 'prod-1', quantity: 1, price: 100 }],
        returningItems: [{ productId: 'prod-1', quantity: 1 }],
        returnReason: 'wrong size',
      },
      actor,
    );

    expect(store.orders).toHaveLength(1);
    expect(store.orders[0].kind).toBe('EXCHANGE');
    expect(returnsCreate).toHaveBeenCalledTimes(1);
    expect(returnsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        type: 'EXCHANGE',
        source: 'EXCHANGE',
        items: [{ productId: 'prod-1', variantId: null, quantity: 1 }],
        exchangeOrderId: store.orders[0].id,
        reason: 'wrong size',
      }),
      actor.email,
      expect.anything(),
    );
    expect(res.mode).toBe('PARTIAL');
    expect(order.statusId).toBe('st-return-pending');
  });

  it('PARTIAL rejects zero quantities and products outside the original', async () => {
    const { service, store, returnsCreate } = await setup({ order: makeOrder() });
    await expect(
      service.createFromOrder(
        'order-1',
        {
          mode: 'PARTIAL',
          items: [{ productId: 'prod-1', quantity: 1, price: 100 }],
          returningItems: [{ productId: 'prod-1', quantity: 0 }],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createFromOrder(
        'order-1',
        {
          mode: 'PARTIAL',
          items: [{ productId: 'prod-1', quantity: 1, price: 100 }],
          returningItems: [{ productId: 'ghost', quantity: 1 }],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.orders).toHaveLength(0);
    expect(returnsCreate).not.toHaveBeenCalled();
  });
});

describe('ExchangeService — readiness (both signals, Task 4 Fix 8)', () => {
  it('reports unlinked when there is no exchange and no EXCHANGE return', async () => {
    const { service } = await setup({});
    const r = await service.getExchangeReadiness('order-1');
    expect(r).toMatchObject({ linked: false, canConfirmReturned: true });
  });

  it('blocks when the exchange order has not been delivered', async () => {
    const { service } = await setup({
      dispatches: [{ orderId: 'ex-1', status: 'SHIPPING' }],
      exReturns: [],
    });
    (service as any).prisma.order.findMany = async () => [
      { id: 'ex-1', displayId: 'EX-260930-0001' },
    ];
    const r = await service.getExchangeReadiness('order-1');
    expect(r.canConfirmReturned).toBe(false);
    expect(r.exchangeDelivered).toBe(false);
    expect(r.blockReason).toMatch(/EX-260930-0001/);
  });

  it('blocks when delivered but the EXCHANGE return has not arrived', async () => {
    const { service } = await setup({
      dispatches: [{ orderId: 'ex-1', status: 'DELIVERED' }],
      exReturns: [{ id: 'ret-1', displayId: 'RTN-260930-0001', status: 'REQUESTED' }],
    });
    (service as any).prisma.order.findMany = async () => [
      { id: 'ex-1', displayId: 'EX-260930-0001' },
    ];
    const r = await service.getExchangeReadiness('order-1');
    expect(r.canConfirmReturned).toBe(false);
    expect(r.exchangeDelivered).toBe(true);
    expect(r.returnArrived).toBe(false);
    expect(r.blockReason).toMatch(/RTN-260930-0001/);
  });

  it.each(['RECEIVED', 'RESTOCKED'])(
    'allows when the exchange is delivered and the return is %s',
    async (status) => {
      const { service } = await setup({
        dispatches: [{ orderId: 'ex-1', status: 'DELIVERED' }],
        exReturns: [{ id: 'ret-1', displayId: 'RTN-260930-0001', status }],
      });
      (service as any).prisma.order.findMany = async () => [
        { id: 'ex-1', displayId: 'EX-260930-0001' },
      ];
      const r = await service.getExchangeReadiness('order-1');
      expect(r).toMatchObject({
        linked: true,
        exchangeDelivered: true,
        returnArrived: true,
        canConfirmReturned: true,
      });
    },
  );
});
