import { Test, TestingModule } from '@nestjs/testing';
import { ExchangeService } from '../exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { OrdersEventService } from '../../orders/orders-event.service';
import { CacheService } from '../../cache/cache.service';
import { ReturnsService } from '../../returns/returns.service';

/**
 * MED transfer leg: transfer row lacks sourcePaymentId + uncapped creditApplied.
 * RED phase: both tests fail until exchange.service.ts is fixed.
 */
describe('ExchangeService — transfer leg hardening (MED)', () => {
  const actor = { userId: 'u1', email: 'staff@ecomate.com' };

  const product = () => ({
    id: 'prod-1',
    name: 'Widget',
    manageStock: true,
    reservedStock: 0,
    availabilityMode: 'MANAGED_STOCK',
    managedStockQuantity: 50,
    variants: [],
  });

  const makeOrder = () => ({
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
  });

  async function setup(opts: { paidAmount?: number; largestId?: string | null } = {}) {
    const { paidAmount = 1000, largestId = 'pay-big' } = opts;
    const orders: any[] = [];
    const orderItems: any[] = [];
    const payments: any[] = [];
    const order = makeOrder();
    const statuses = [
      { id: 'st-confirmed', name: 'Confirmed' },
      { id: 'st-return-pending', name: 'Return Pending' },
    ];
    const tx: any = {
      $executeRaw: async () => 0,
      order: {
        create: async ({ data }: any) => {
          const created = { id: `ex-${orders.length + 1}`, ...data };
          orders.push(created);
          return created;
        },
        findUnique: async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null,
        update: async ({ where, data }: any) => {
          const t = orders.find((o) => o.id === where.id) ?? (order.id === where.id ? order : undefined);
          if (!t) throw new Error(`order ${where.id} not found`);
          Object.assign(t, data);
          return t;
        },
        aggregate: async () => ({ _sum: { exchangedCreditAmount: 0 } }),
        findFirst: async () => null,
      },
      orderItem: {
        create: async ({ data }: any) => {
          const created = { id: `it-${orderItems.length + 1}`, ...data };
          orderItems.push(created);
          return created;
        },
        findFirst: async ({ where }: any) => orderItems.find((i) => i.orderId === where.orderId) ?? null,
      },
      orderStatus: {
        findUnique: async ({ where }: any) => statuses.find((s) => s.name === where.name) ?? null,
      },
      payment: {
        aggregate: async () => ({ _sum: { amount: paidAmount } }),
        findFirst: async () =>
          largestId ? { id: largestId, amount: paidAmount } : null,
        create: async ({ data }: any) => {
          const created = { id: `pay-${payments.length + 1}`, ...data };
          payments.push(created);
          return created;
        },
      },
      refund: {
        create: async ({ data }: any) => ({ id: 'rf-1', ...data }),
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
        findUnique: async ({ where }: any) => (where.id === order.id ? order : tx.order.findUnique({ where })),
      },
      payment: { aggregate: async () => ({ _sum: { amount: paidAmount } }) },
      product: { findMany: async () => [product()] },
      refund: { findMany: async () => [] },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: OrdersService,
          useValue: {
            recalculate: (items: any[], shipping: number, discount: number, type = 'flat') => {
              const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
              const eff = type === 'percentage' ? subtotal * (discount / 100) : discount;
              return { subtotal, total: Math.max(0, subtotal + shipping - eff) };
            },
            applyStockForLine: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: OrdersEventService, useValue: { emit: jest.fn() } },
        { provide: CacheService, useValue: { invalidateByPrefix: jest.fn() } },
        {
          provide: ReturnsService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'ret-1', displayId: 'RTN-1' }),
            orderItemsSnapshot: jest.fn().mockResolvedValue([]),
            validateItemsInput: jest.fn((items: any) => items),
          },
        },
      ],
    }).compile();
    return { service: module.get(ExchangeService), store: { orders, payments, tx } };
  }

  it('transfer row carries sourcePaymentId = largest PAID row of original', async () => {
    const { service, store } = await setup({ paidAmount: 1000, largestId: 'pay-big' });
    await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 600 }] } as any,
      actor,
    );
    const transfers = store.payments.filter((p) => p.gatewayCode === 'exchange_transfer');
    expect(transfers).toHaveLength(1);
    expect(transfers[0].sourcePaymentId).toBe('pay-big');
  });

  it('transfer row sourcePaymentId is null when original has no PAID rows', async () => {
    const { service, store } = await setup({ paidAmount: 0, largestId: null });
    // No recorded paid → available 0 → no transfer row when exchangeTotal > 0?
    // Use exchangeTotal 0? Instead force a paidConfirmed WITH reason so credit
    // exists but no PAID rows: recorded 0, confirmed 600 with reason.
    await service.createFromOrder(
      'order-1',
      {
        items: [{ productId: 'prod-1', quantity: 1, price: 600 }],
        paidConfirmed: 600,
        paidAdjustmentReason: 'Cash collected off-ledger, confirmed by staff.',
      } as any,
      actor,
    );
    const transfers = store.payments.filter((p) => p.gatewayCode === 'exchange_transfer');
    expect(transfers).toHaveLength(1);
    expect(transfers[0].sourcePaymentId).toBeNull();
  });

  it('uncapped creditApplied without adjustment reason → 400', async () => {
    const { service, store } = await setup({ paidAmount: 1000 });
    const tx = store.tx;
    const original = { id: 'order-1', displayId: 'ORD-260930-0007' };
    store.orders.push({ id: 'ex-1', exchangeOfOrderId: 'order-1', timeline: [] });
    await expect(
      (service as any).settle(tx, original, 1200, 'ex-1', actor, new Date().toISOString(), {
        effectivePaid: 1500,
        recordedPaid: 1000,
        paidConfirmed: null,
        paidAdjustmentReason: null,
      }),
    ).rejects.toThrow(/credit.*recorded|exceeds.*recorded|adjustment/i);
  });
});
