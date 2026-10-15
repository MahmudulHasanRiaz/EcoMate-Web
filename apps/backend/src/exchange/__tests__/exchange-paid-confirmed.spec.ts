import { Test, TestingModule } from '@nestjs/testing';
import { ExchangeService } from '../exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { OrdersEventService } from '../../orders/orders-event.service';
import { CacheService } from '../../cache/cache.service';
import { ReturnsService } from '../../returns/returns.service';

/**
 * Return/Exchange hardening (4): EXCHANGE paid-amount (backend).
 *
 * Exchange create accepts paidConfirmed (+ adjustment reason, required when
 * it differs from recorded payments) and records the reallocation
 * transparently as transfer-linked PAID payment rows
 * (gateway 'exchange_transfer', sourceOrderId = original, appliedCreditAmount
 * NULL per the D-C actuals-only ledger — coverage via `amount`, mirroring the
 * customer_credit row convention, so the same taka is never double-counted).
 *
 * Invariants:
 *  - due(exchange) = total − paidConfirmed-effective
 *  - Σ actuals conserved (non-transfer Σ PAID unchanged; transfer rows are
 *    gateway-marked and excluded from that sum)
 *  - original available credit reduced by the transferred amount
 *    (second exchange sees available − creditApplied; original rows untouched)
 *
 * RED phase: paidConfirmed is not accepted and no transfer rows exist.
 */
describe('ExchangeService — paidConfirmed + transfer rows (hardening 4)', () => {
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

  async function setup(paidAmount = 1000) {
    const orders: any[] = [];
    const orderItems: any[] = [];
    const refunds: any[] = [];
    const payments: any[] = [];
    let counter = 0;
    const order = makeOrder();
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
          const t = orders.find((o) => o.id === where.id) ?? (order.id === where.id ? order : undefined);
          if (!t) throw new Error(`order ${where.id} not found`);
          Object.assign(t, data);
          return t;
        },
        aggregate: async ({ where }: any) => {
          const sum = orders
            .filter((o) => o.exchangeOfOrderId === where.exchangeOfOrderId && o.exchangedCreditAmount != null)
            .reduce((s, o) => s + Number(o.exchangedCreditAmount), 0);
          return { _sum: { exchangedCreditAmount: sum } };
        },
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
        findFirst: async () => ({ id: 'pay-big', amount: paidAmount }),
        create: async ({ data }: any) => {
          const created = { id: `pay-${payments.length + 1}`, ...data };
          payments.push(created);
          return created;
        },
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
            create: jest.fn().mockImplementation((dto: any) =>
              Promise.resolve({ id: 'ret-1', displayId: 'RTN-1', status: 'REQUESTED', ...dto }),
            ),
            orderItemsSnapshot: jest.fn().mockResolvedValue([]),
            validateItemsInput: jest.fn((items: any) => items),
          },
        },
      ],
    }).compile();
    return { service: module.get(ExchangeService), store: { orders, orderItems, refunds, payments } };
  }

  const dueOf = (total: number, rows: any[]) =>
    total -
    rows
      .filter((p) => p.status === 'PAID')
      .reduce((s, p) => s + Number(p.amount) + Number(p.appliedCreditAmount ?? 0), 0);

  it('due(exchange) = total − paidConfirmed (transfer row covers the bill)', async () => {
    const { service, store } = await setup(1000);
    const res = await service.createFromOrder(
      'order-1',
      {
        items: [{ productId: 'prod-1', quantity: 2, price: 600 }],
        paidConfirmed: 600,
        paidAdjustmentReason: 'Customer showed bKash SMS for 600; ledger says 1000.',
      } as any,
      actor,
    );

    expect(res.settlement.originalPaid).toBe(600);
    expect(res.settlement.creditApplied).toBe(600);
    expect(res.settlement.delta).toBe(600);
    const exRows = store.payments.filter((p) => p.orderId === store.orders[0].id);
    expect(dueOf(res.settlement.exchangeTotal, exRows)).toBe(res.settlement.delta);
  });

  it('Σ actuals conserved: transfer rows are gateway-marked, non-transfer Σ unchanged', async () => {
    const { service, store } = await setup(1000);
    await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 2, price: 600 }] } as any,
      actor,
    );

    const transfers = store.payments.filter((p) => p.gatewayCode === 'exchange_transfer');
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      status: 'PAID',
      sourceOrderId: 'order-1',
      appliedCreditAmount: null,
    });
    expect(Number(transfers[0].amount)).toBe(1000);
    // No fresh money moved: every non-transfer PAID row sums to the recorded 1000.
    const nonTransfer = store.payments.filter((p) => p.gatewayCode !== 'exchange_transfer');
    expect(nonTransfer.reduce((s, p) => s + Number(p.amount), 0)).toBe(0);
    // And the original carries no new payment rows at all.
    expect(store.payments.filter((p) => p.orderId === 'order-1')).toHaveLength(0);
  });

  it('original available credit is reduced by the transferred amount', async () => {
    const { service, store } = await setup(1000);
    await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 600 }] } as any,
      actor,
    );
    expect(store.orders[0].exchangedCreditAmount).toBe(600);

    const second = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 100 }] } as any,
      actor,
    );
    expect(second.settlement.availableCredit).toBe(400);
    expect(second.settlement.creditApplied).toBe(100);
  });

  it('paidConfirmed differing from recorded payments requires an adjustment reason', async () => {
    const { service } = await setup(1000);
    await expect(
      service.createFromOrder(
        'order-1',
        { items: [{ productId: 'prod-1', quantity: 1, price: 600 }], paidConfirmed: 600 } as any,
        actor,
      ),
    ).rejects.toThrow(/paidAdjustmentReason/);
  });

  it('paidConfirmed matching recorded payments needs no reason', async () => {
    const { service } = await setup(1000);
    const res = await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 600 }], paidConfirmed: 1000 } as any,
      actor,
    );
    expect(res.settlement.originalPaid).toBe(1000);
    expect(res.settlement.status).toBe('SETTLED_REFUND');
  });

  it('refund legs carry the source payment link for reconciliation', async () => {
    const { service, store } = await setup(1000);
    await service.createFromOrder(
      'order-1',
      { items: [{ productId: 'prod-1', quantity: 1, price: 600 }] } as any,
      actor,
    );
    expect(store.refunds).toHaveLength(1);
    expect(store.refunds[0].sourcePaymentId).toBe('pay-big');
  });
});
