import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { RtnService } from './rtn.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { OrdersEventService } from '../orders/orders-event.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { StockService } from '../stock/stock.service';
import { CacheService } from '../cache/cache.service';
import { Prisma } from '@prisma/client';

/** Stock primitives RtnService calls directly (removed-line hold release). */
const STOCK_STUB = {
  operate: jest.fn().mockResolvedValue(undefined),
  releasePhysicalAllocated: jest.fn().mockResolvedValue(undefined),
};

/**
 * In-memory Prisma fake covering exactly the code paths RtnService touches.
 * $transaction runs the callback against the same fake, so atomicity
 * behaviour (rollback = throw before commit) is exercised for real.
 */
function makePrismaFake(state: {
  order: any;
  items: any[];
  snapshots?: any[];
  dispatches?: any[];
  rtnOrders?: any[];
  failOnRtnCreate?: boolean;
}) {
  const orders = state.rtnOrders ? [...state.rtnOrders] : [];
  const items = [...state.items];
  const snapshots = [...(state.snapshots ?? [])];
  const dispatches = [...(state.dispatches ?? [])];
  const returns: any[] = [];
  const original = state.order;

  const statusName = (id: string) =>
    id === 'status-return-pending'
      ? 'Return Pending'
      : id === 'status-delivered'
        ? 'Delivered'
        : id === 'status-returned'
          ? 'Returned'
          : id === 'status-partial'
            ? 'Partial'
            : id;

  const withItems = (o: any) => {
    const attached =
      Array.isArray(o.items) && o.items.length > 0
        ? o.items
        : items.filter((i) => i.orderId === o.id);
    return {
      ...o,
      items: attached,
      _count: { items: attached.length },
      status: o.status ?? (o.statusId ? { id: o.statusId, name: statusName(o.statusId) } : undefined),
    };
  };

  const tx = {
    order: {
      findUnique: async ({ where }: any) => {
        const found =
          where.id === original.id ? original : orders.find((o) => o.id === where.id) ?? null;
        return found ? withItems(found) : null;
      },
      findFirst: async ({ where }: any) => {
        // `returnedAt: null` is the "still open" filter — honour it, otherwise
        // the fake reports a closed RTN as blocking a new split.
        const matchesOpen =
          where.returnOfOrderId === undefined || where.returnedAt === undefined
            ? () => true
            : (o: any) =>
                where.returnedAt === null ? o.returnedAt == null : o.returnedAt === where.returnedAt;
        const found = where.returnOfOrderId
          ? orders.find(
              (o) => o.returnOfOrderId === where.returnOfOrderId && matchesOpen(o),
            )
          : where.id
            ? orders.find((o) => o.id === where.id)
            : null;
        return found ? withItems(found) : null;
      },
      findMany: async ({ where }: any) => {
        // order.findMany returns ORDERS (findAllForOriginalOrder); the item
        // lookup uses orderItem.findMany instead.
        if (where?.returnOfOrderId !== undefined) {
          return orders
            .filter((o) => o.returnOfOrderId === where.returnOfOrderId)
            .map((o) => withItems(o));
        }
        return items.filter((i) => i.orderId === where?.orderId);
      },
      create: async ({ data }: any) => {
        if (state.failOnRtnCreate) {
          const err: any = new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed',
            { code: 'P2002', clientVersion: '5.0.0' } as any,
          );
          throw err;
        }
        const created = { id: `rtn-${orders.length + 1}`, ...data };
        orders.push(created);
        return created;
      },
      update: async ({ where, data }: any) => {
        const target =
          where.id === original.id ? original : orders.find((o) => o.id === where.id);
        if (!target) throw new Error(`order ${where.id} not found`);
        Object.assign(target, data);
        return target;
      },
    },
    orderItem: {
      create: async ({ data }: any) => {
        const created = { id: `item-${items.length + 1}`, ...data };
        items.push(created);
        return created;
      },
      update: async ({ where, data }: any) => {
        const target = items.find((i) => i.id === where.id);
        Object.assign(target, data);
        return target;
      },
      delete: async ({ where }: any) => {
        const idx = items.findIndex((i) => i.id === where.id);
        const [removed] = items.splice(idx, 1);
        for (let i = snapshots.length - 1; i >= 0; i--) {
          if (snapshots[i].orderItemId === where.id) snapshots.splice(i, 1);
        }
        return removed;
      },
      findMany: async ({ where }: any) => items.filter((i) => i.orderId === where.orderId),
    },
    orderItemComboComponent: {
      findMany: async ({ where }: any) =>
        snapshots.filter((s) => s.orderItemId === where.orderItemId),
      create: async ({ data }: any) => {
        const created = { id: `snap-${snapshots.length + 1}`, ...data };
        snapshots.push(created);
        return created;
      },
      update: async ({ where, data }: any) => {
        const target = snapshots.find((s) => s.id === where.id);
        Object.assign(target, data);
        return target;
      },
    },
    orderStatus: {
      findUnique: async ({ where }: any) => {
        if (where.name === 'Return Pending')
          return { id: 'status-return-pending', name: 'Return Pending' };
        if (where.name === 'Delivered')
          return { id: 'status-delivered', name: 'Delivered' };
        if (where.name === 'Returned')
          return { id: 'status-returned', name: 'Returned' };
        return null;
      },
    },
    orderStockCycle: {
      findFirst: async () => ({ id: 'cycle-1', orderId: original.id, status: 'ACTIVE' }),
    },
    dispatch: {
      findUnique: async ({ where }: any) => dispatches.find((d) => d.id === where.id) ?? null,
      updateMany: async ({ where, data }: any) => {
        const target = dispatches.find((d) => d.id === where.id);
        if (!target || target.status !== where.status) return { count: 0 };
        Object.assign(target, data);
        return { count: 1 };
      },
    },
    return: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const created = { id: `ret-${returns.length + 1}`, ...data };
        returns.push(created);
        return created;
      },
      update: async ({ where, data }: any) => {
        const target = returns.find((r) => r.id === where.id);
        Object.assign(target, data);
        return target;
      },
    },
    returnCounter: {
      upsert: async () => ({ seq: 1 }),
    },
    costingLotConsumption: { findFirst: async () => null },
    costingLotRestoration: { create: async ({ data }: any) => data },
    costingLot: { update: async () => ({}) },
    // appendOrderTimeline issues: UPDATE "Order" SET timeline = ... || $1::jsonb
    // WHERE id = $2. Mirror it so timeline assertions stay behaviour-level.
    $executeRaw: async (_strings: any, ...values: any[]) => {
      const [payload, orderId] = values;
      const target =
        orderId === original.id ? original : orders.find((o) => o.id === orderId);
      if (target) {
        const current = Array.isArray(target.timeline) ? target.timeline : [];
        target.timeline = [...current, ...JSON.parse(payload)];
      }
      return 1;
    },
  };

  const prisma = {
    order: tx.order,
    orderItem: tx.orderItem,
    orderItemComboComponent: tx.orderItemComboComponent,
    orderStatus: tx.orderStatus,
    orderStockCycle: tx.orderStockCycle,
    dispatch: tx.dispatch,
    return: tx.return,
    returnCounter: tx.returnCounter,
    costingLotConsumption: tx.costingLotConsumption,
    costingLotRestoration: tx.costingLotRestoration,
    costingLot: tx.costingLot,
    $transaction: async (cb: any) => cb(tx),
  };

  return { prisma: prisma as unknown as PrismaService, tx, store: { orders, items, snapshots, dispatches, returns } };
}

const actor = { userId: 'user-1', email: 'staff@ecomate.com' };

const deliveredOrder = (overrides: any = {}) =>
  makePartialOrder({
    status: { id: 'status-delivered', name: 'Delivered', nextStatuses: ['status-return-pending'] },
    statusId: 'status-delivered',
    ...overrides,
  });

function makePartialOrder(overrides: any = {}) {
  return {
    id: 'order-1',
    displayId: 'ORD-260930-0001',
    kind: 'SALE',
    returnOfOrderId: null,
    statusId: 'status-partial',
    status: { id: 'status-partial', name: 'Partial', nextStatuses: ['status-return-pending'] },
    subtotal: 1000,
    shippingCharge: 60,
    discount: 0,
    discountType: 'flat',
    total: 1060,
    shippingAddress: { city: 'Dhaka' },
    customerEmail: 'c@example.com',
    customerPhone: '+8801711111111',
    customerFirstName: 'Cust',
    customerLastName: 'Omer',
    customerCity: 'Dhaka',
    customerState: 'Dhaka',
    customerZip: '1200',
    customerCountry: 'BD',
    guestName: null,
    guestPhone: null,
    timeline: [{ status: 'Partial', oldStatus: 'Shipping', timestamp: new Date().toISOString(), note: '', performedBy: 'system' }],
    trashedAt: null,
    ...overrides,
  };
}

describe('RtnService — createFromPartialOrder', () => {
  let service: RtnService;
  let prisma: PrismaService;
  let events: OrdersEventService;
  let cancelReturnStock: CancelReturnStockService;

  async function setup(order: any, items: any[], snapshots: any[] = []) {
    const fake = makePrismaFake({
      order,
      items: items.map((i) => ({ ...i })),
      snapshots: snapshots.map((s) => ({ ...s })),
    });
    prisma = fake.prisma;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RtnService,
        { provide: PrismaService, useValue: fake.prisma },
        { provide: StockService, useValue: STOCK_STUB },
        { provide: OrdersService, useValue: { recalculate: (items: any[], shipping: number, discount: number, type = 'flat') => {
          const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
          return { subtotal, total: Math.max(0, subtotal + shipping - discount) };
        } } },
        { provide: OrdersEventService, useValue: { emit: jest.fn() } },
        { provide: DispatchService, useValue: {} },
        { provide: CancelReturnStockService, useValue: { restoreForOrder: jest.fn(), restoreForReturnOrder: jest.fn().mockResolvedValue({ restored: true }) } },
        { provide: CacheService, useValue: { invalidateByPrefix: jest.fn() } },
      ],
    }).compile();
    service = module.get(RtnService);
    events = module.get(OrdersEventService);
    cancelReturnStock = module.get(CancelReturnStockService);
    order.items = fake.store.items.filter((i) => i.orderId === order.id);
    return fake.store;
  }

  const simpleItems = [
    { id: 'item-1', orderId: 'order-1', productId: 'prod-1', variantId: null, comboId: null, quantity: 5, price: 100, sourceWarehouseId: 'wh-1', managedStockReserved: true, managedStockDeducted: true },
    { id: 'item-2', orderId: 'order-1', productId: 'prod-2', variantId: null, comboId: null, quantity: 3, price: 200, sourceWarehouseId: 'wh-1', managedStockReserved: true, managedStockDeducted: true },
  ];

  it('creates the RTN from a Partial order and adjusts the original', async () => {
    const order = makePartialOrder();
    const store = await setup(order, simpleItems.map((i) => ({ ...i })));

    const rtn = await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 2 }] },
      actor,
    );

    // RTN order: new id, RTN- display id, kind RETURN, Return Pending
    expect(rtn.displayId).toBe('RTN-260930-0001');
    expect(rtn.kind).toBe('RETURN');
    expect(rtn.returnOfOrderId).toBe('order-1');
    expect(rtn.status.name).toBe('Return Pending');
    expect(rtn.id).not.toBe('order-1');

    // RTN items: exact returned quantities + source link
    expect(rtn.items).toHaveLength(1);
    expect(rtn.items[0].quantity).toBe(2);
    expect(rtn.items[0].sourceOrderItemId).toBe('item-1');
    expect(rtn.items[0].managedStockReserved).toBe(false);
    expect(rtn.items[0].managedStockDeducted).toBe(false);

    // Original: quantity reduced, status Delivered, totals recalculated
    expect(order.items.find((i: any) => i.id === 'item-1').quantity).toBe(3);
    expect(order.statusId).toBe('status-delivered');
    expect(order.subtotal).toBe(3 * 100 + 3 * 200);
    expect(order.total).toBe(3 * 100 + 3 * 200 + 60);
    expect(order.timeline.some((t: any) => t.status === 'Delivered' && t.oldStatus === 'Partial')).toBe(true);

    // No stock mutation at creation
    expect(cancelReturnStock.restoreForReturnOrder).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
  });

  it('removes a fully-returned line from the original order', async () => {
    const order = makePartialOrder();
    const store = await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-2', quantity: 3 }] },
      actor,
    );

    expect(store.items.find((i) => i.id === 'item-2')).toBeUndefined();
    expect(order.statusId).toBe('status-delivered');
  });

  it('handles multiple products and quantities in one RTN', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems.map((i) => ({ ...i })));

    const rtn = await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 2 }, { orderItemId: 'item-2', quantity: 1 }] },
      actor,
    );

    expect(rtn.items).toHaveLength(2);
    expect(order.items.find((i: any) => i.id === 'item-1').quantity).toBe(3);
    expect(order.items.find((i: any) => i.id === 'item-2').quantity).toBe(2);
  });

  it('supports variants and freezes combo component snapshots on the RTN', async () => {
    const order = makePartialOrder();
    const items = [
      { id: 'item-1', orderId: 'order-1', productId: 'prod-1', variantId: 'var-1', comboId: 'combo-1', comboSelection: { 'p1': 'var-1' }, quantity: 2, price: 500, sourceWarehouseId: 'wh-1', managedStockReserved: true, managedStockDeducted: true },
    ];
    const snapshots = [
      { id: 'snap-1', orderItemId: 'item-1', comboItemId: 'ci-1', productId: 'comp-1', variantId: null, unitQuantity: 2, totalQuantity: 4, managedStockReserved: true, managedStockDeducted: true },
      { id: 'snap-2', orderItemId: 'item-1', comboItemId: 'ci-2', productId: 'comp-2', variantId: null, unitQuantity: 1, totalQuantity: 2, managedStockReserved: true, managedStockDeducted: true },
    ];
    const store = await setup(order, items, snapshots);

    const rtn = await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 1 }] },
      actor,
    );

    // RTN combo snapshots: unitQuantity × returned qty
    const rtnItem = store.items.find((i) => i.orderId === rtn.id);
    const rtnSnaps = store.snapshots.filter((s) => s.orderItemId === rtnItem.id);
    expect(rtnSnaps).toHaveLength(2);
    expect(rtnSnaps.find((s) => s.comboItemId === 'ci-1').totalQuantity).toBe(2);
    expect(rtnSnaps.find((s) => s.comboItemId === 'ci-2').totalQuantity).toBe(1);

    // Original snapshots follow the reduced quantity (2 - 1 = 1 × unit)
    expect(store.snapshots.find((s) => s.id === 'snap-1').totalQuantity).toBe(2);
    expect(store.snapshots.find((s) => s.id === 'snap-2').totalQuantity).toBe(1);
    expect(order.items.find((i: any) => i.id === 'item-1').quantity).toBe(1);
  });

  it('rejects non-Partial orders', async () => {
    const order = makePartialOrder({ status: { id: 's', name: 'Delivered', nextStatuses: [] }, statusId: 's' });
    await setup(order, simpleItems);
    await expect(
      service.createFromPartialOrder('order-1', { items: [{ orderItemId: 'item-1', quantity: 1 }] }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an existing RTN (one original → one RTN)', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems);
    await service.createFromPartialOrder('order-1', { items: [{ orderItemId: 'item-1', quantity: 1 }] }, actor);
    await expect(
      service.createFromPartialOrder('order-1', { items: [{ orderItemId: 'item-2', quantity: 1 }] }, actor),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects quantity greater than the current line quantity', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems);
    await expect(
      service.createFromPartialOrder('order-1', { items: [{ orderItemId: 'item-1', quantity: 6 }] }, actor),
    ).rejects.toThrow(/cannot exceed/);
  });

  it('rejects duplicate item lines', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems);
    await expect(
      service.createFromPartialOrder(
        'order-1',
        { items: [{ orderItemId: 'item-1', quantity: 1 }, { orderItemId: 'item-1', quantity: 1 }] },
        actor,
      ),
    ).rejects.toThrow(/Duplicate/);
  });

  it('rejects items that do not belong to the original order', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems);
    await expect(
      service.createFromPartialOrder('order-1', { items: [{ orderItemId: 'item-999', quantity: 1 }] }, actor),
    ).rejects.toThrow(/must belong/);
  });

  it('returns a deterministic 409 when the database unique constraint wins the race', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems, [], );
    // Simulate the second concurrent creator: the RTN insert violates
    // returnOfOrderId uniqueness.
    const fake = makePrismaFake({ order, items: simpleItems.map((i) => ({ ...i })), failOnRtnCreate: true });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RtnService,
        { provide: PrismaService, useValue: fake.prisma },
        { provide: StockService, useValue: STOCK_STUB },
        { provide: OrdersService, useValue: { recalculate: () => ({ subtotal: 0, total: 0 }) } },
        { provide: OrdersEventService, useValue: { emit: jest.fn() } },
        { provide: DispatchService, useValue: {} },
        { provide: CancelReturnStockService, useValue: { restoreForOrder: jest.fn(), restoreForReturnOrder: jest.fn() } },
        { provide: CacheService, useValue: { invalidateByPrefix: jest.fn() } },
      ],
    }).compile();
    const svc = module.get(RtnService);
    await expect(
      svc.createFromPartialOrder('order-1', { items: [{ orderItemId: 'item-1', quantity: 1 }] }, actor),
    ).rejects.toThrow(ConflictException);
    // Original untouched — the transaction rolled back.
    expect(order.statusId).toBe('status-partial');
    expect(order.items.find((i: any) => i.id === 'item-1').quantity).toBe(5);
  });

  it('emits status_changed events for both orders', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems);
    await service.createFromPartialOrder('order-1', { items: [{ orderItemId: 'item-1', quantity: 1 }] }, actor);
    expect(events.emit).toHaveBeenCalledTimes(2);
  });

  it('releases a removed line\'s holds before deleting it (no orphaned reservation)', async () => {
    STOCK_STUB.operate.mockClear();
    STOCK_STUB.releasePhysicalAllocated.mockClear();
    const order = makePartialOrder();
    // Reserved but NOT yet deducted: the hold would otherwise outlive the line.
    const items = [
      {
        id: 'item-1', orderId: 'order-1', productId: 'prod-1', variantId: 'var-1', comboId: null,
        quantity: 2, price: 100, sourceWarehouseId: 'wh-1',
        managedStockReserved: true, managedStockDeducted: false,
        product: { availabilityMode: 'MANAGED_STOCK', manageStock: true },
      },
    ];
    const store = await setup(order, items);

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 2 }] },
      actor,
    );

    expect(store.items.find((i) => i.id === 'item-1')).toBeUndefined();
    expect(STOCK_STUB.operate).toHaveBeenCalledWith(
      'release',
      expect.objectContaining({
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        reference: expect.stringContaining('RTN-260930-0001'),
      }),
    );
    expect(STOCK_STUB.releasePhysicalAllocated).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        cycleId: 'cycle-1',
        orderItemId: 'item-1',
      }),
    );
  });

  it('does not release a hold for a DEDUCTED line (the RTN restore owns that quantity)', async () => {
    STOCK_STUB.operate.mockClear();
    const order = makePartialOrder();
    await setup(order, [
      {
        id: 'item-1', orderId: 'order-1', productId: 'prod-1', variantId: null, comboId: null,
        quantity: 2, price: 100, sourceWarehouseId: 'wh-1',
        managedStockReserved: true, managedStockDeducted: true,
        product: { availabilityMode: 'MANAGED_STOCK', manageStock: true },
      },
    ]);

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 2 }] },
      actor,
    );

    expect(STOCK_STUB.operate).not.toHaveBeenCalled();
  });

  it('appends the timeline atomically — an existing entry is never lost', async () => {
    const order = makePartialOrder();
    order.timeline = [
      { type: 'note', visibility: 'public', timestamp: '2026-09-29T10:00:00.000Z', note: 'Customer called about delivery', performedBy: 'staff@ecomate.com' },
      { status: 'Partial', oldStatus: 'Shipping', timestamp: '2026-09-29T11:00:00.000Z', note: '', performedBy: 'system' },
    ];
    await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 2 }] },
      actor,
    );

    expect(order.timeline).toHaveLength(3);
    expect(order.timeline[0].note).toBe('Customer called about delivery');
    expect(order.timeline[2].status).toBe('Delivered');
  });

  // ── §2: ONE overall reason ───────────────────────────────────────────
  it('stores a single overall reason on the RTN and both timelines', async () => {
    const order = makePartialOrder();
    const store = await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      {
        items: [{ orderItemId: 'item-1', quantity: 2 }],
        reason: 'Customer rejected two units — wrong size',
      },
      actor,
    );

    const rtn = store.orders[0];
    expect(rtn.officeNotes).toBe('Customer rejected two units — wrong size');
    expect(rtn.timeline[0].reason).toBe('Customer rejected two units — wrong size');
    expect(order.timeline.some((t: any) => t.note?.includes('Customer rejected two units'))).toBe(true);
  });

  // ── §3: original financial adjustment ───────────────────────────────
  it('applies an explicit discount reduction to the ORIGINAL only', async () => {
    const order = makePartialOrder({ discount: 200, subtotal: 1000, total: 860 });
    const store = await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      {
        items: [{ orderItemId: 'item-1', quantity: 2 }],
        // Returning 2×100 = 200 of goods, so halve the discount.
        adjustOriginalDiscount: 100,
      },
      actor,
    );

    // Remaining items: item-1 ×3 @100 = 300, item-2 ×3 @200 = 600 → 900.
    expect(order.subtotal).toBe(900);
    expect(order.discount).toBe(100);
    expect(order.total).toBe(900 + 60 - 100);
    // The RTN never carries the discount — the money lives in one place only.
    expect(store.orders[0].discount).toBe(0);
    expect(store.orders[0].shippingCharge).toBe(0);
    expect(order.timeline.some((t: any) => t.type === 'discount')).toBe(true);
  });

  it('adjusts the original shipping charge independently of the discount', async () => {
    const order = makePartialOrder({ shippingCharge: 60 });
    const store = await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 2 }], adjustOriginalShippingCharge: 0 },
      actor,
    );

    expect(order.shippingCharge).toBe(0);
    expect(order.total).toBe(900 - 0);
    expect(store.orders[0].shippingCharge).toBe(0);
    expect(order.timeline.some((t: any) => t.type === 'shipping')).toBe(true);
  });

  it('leaves the original financials untouched when no adjustment is supplied', async () => {
    const order = makePartialOrder({ discount: 50, shippingCharge: 60 });
    await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 2 }] },
      actor,
    );

    expect(order.discount).toBe(50);
    expect(order.shippingCharge).toBe(60);
    // Remaining 900 + 60 − 50 = 910 (the discount survives on the smaller bill,
    // which is exactly the pre-existing behaviour).
    expect(order.total).toBe(910);
    expect(order.timeline.some((t: any) => t.type === 'discount')).toBe(false);
  });

  it('rejects a discount larger than the remaining order amount', async () => {
    const order = makePartialOrder({ discount: 0 });
    await setup(order, simpleItems.map((i) => ({ ...i })));

    await expect(
      service.createFromPartialOrder(
        'order-1',
        { items: [{ orderItemId: 'item-1', quantity: 2 }], adjustOriginalDiscount: 5000 },
        actor,
      ),
    ).rejects.toThrow(/cannot exceed the remaining order amount/i);
  });

  it('rejects a negative shipping adjustment', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems.map((i) => ({ ...i })));

    await expect(
      service.createFromPartialOrder(
        'order-1',
        { items: [{ orderItemId: 'item-1', quantity: 1 }], adjustOriginalShippingCharge: -10 },
        actor,
      ),
    ).rejects.toThrow(/cannot be negative/i);
  });

  // ── §5: "is the remaining quantity delivered?" ──────────────────────
  it('leaves the original Partial when deliverRemainingImmediately is false', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 2 }], deliverRemainingImmediately: false },
      actor,
    );

    expect(order.statusId).toBe('status-partial');
    const last = order.timeline[order.timeline.length - 1];
    expect(last.note).toMatch(/stay Partial/i);
  });

  it('marks the original Delivered by default (back-compat)', async () => {
    const order = makePartialOrder();
    await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 2 }] },
      actor,
    );

    expect(order.statusId).toBe('status-delivered');
  });

  // ── A5: several RTNs per original, one OPEN at a time ──────────────
  it('blocks a second RTN while one is still open', async () => {
    const order = makePartialOrder();
    const store = await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 1 }] },
      actor,
    );

    // Second attempt while the first RTN has not been received.
    await expect(
      service.createFromPartialOrder(
        'order-1',
        { items: [{ orderItemId: 'item-2', quantity: 1 }] },
        actor,
      ),
    ).rejects.toThrow(/open Return Order already exists/i);
    expect(store.orders).toHaveLength(1);
  });

  it('allows a new split once the previous RTN was received (returnedAt set)', async () => {
    const order = makePartialOrder();
    const store = await setup(order, simpleItems.map((i) => ({ ...i })));

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-1', quantity: 1 }] },
      actor,
    );
    expect(store.orders).toHaveLength(1);

    // The first RTN is physically received → no longer open.
    store.orders[0].returnedAt = new Date();
    store.orders[0].status = { id: 'status-returned', name: 'Returned', nextStatuses: [] };

    // Put the original back into Partial so it is eligible again.
    order.statusId = 'status-partial';
    order.status = { id: 'status-partial', name: 'Partial', nextStatuses: [] };

    await service.createFromPartialOrder(
      'order-1',
      { items: [{ orderItemId: 'item-2', quantity: 1 }] },
      actor,
    );

    expect(store.orders).toHaveLength(2);
  });

  it('ignores a Returned RTN when reporting the open one', async () => {
    const order = makePartialOrder();
    const store = await setup(order, simpleItems.map((i) => ({ ...i })));
    store.orders.push({
      id: 'rtn-old',
      displayId: 'RTN-260930-0001',
      kind: 'RETURN',
      returnOfOrderId: 'order-1',
      statusId: 'status-returned',
      status: { id: 'status-returned', name: 'Returned' },
      returnedAt: new Date(),
      items: [],
    });

    await expect(service.findForOriginalOrder('order-1')).resolves.toBeNull();
    await expect(service.findAllForOriginalOrder('order-1')).resolves.toHaveLength(1);
  });
});

describe('RtnService — finalizeDispatchReturn', () => {
  let service: RtnService;
  let cancelReturnStock: CancelReturnStockService;

  async function setup(opts: {
    order: any;
    rtn?: any;
    dispatch: any;
    items?: any[];
    snapshots?: any[];
  }) {
    const fake = makePrismaFake({
      order: opts.order,
      items: opts.items ?? [],
      snapshots: opts.snapshots ?? [],
      dispatches: [opts.dispatch],
      rtnOrders: opts.rtn ? [opts.rtn] : [],
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RtnService,
        { provide: PrismaService, useValue: fake.prisma },
        { provide: StockService, useValue: STOCK_STUB },
        { provide: OrdersService, useValue: { recalculate: () => ({ subtotal: 0, total: 0 }) } },
        { provide: OrdersEventService, useValue: { emit: jest.fn() } },
        { provide: DispatchService, useValue: {} },
        { provide: CancelReturnStockService, useValue: {
          restoreForOrder: jest.fn().mockResolvedValue(undefined),
          restoreForReturnItems: jest.fn().mockResolvedValue({ restored: [] }),
          restoreForReturnOrder: jest.fn().mockImplementation(async ({ rtnOrderId, tx }: any) => {
            await tx.order.update({ where: { id: rtnOrderId }, data: { stockRestored: true } });
            return { restored: true };
          }),
        } },
        { provide: CacheService, useValue: { invalidateByPrefix: jest.fn() } },
      ],
    }).compile();
    service = module.get(RtnService);
    cancelReturnStock = module.get(CancelReturnStockService);
    return fake.store;
  }

  it('partial return: dispatch → RETURNED, RTN → Returned, original stays Delivered', async () => {
    const order = deliveredOrder();
    const rtn = {
      id: 'rtn-1', displayId: 'RTN-260930-0001', kind: 'RETURN', returnOfOrderId: 'order-1',
      statusId: 'status-return-pending', status: { id: 'status-return-pending', name: 'Return Pending' },
      stockRestored: false, returnedAt: null, timeline: [],
      items: [{ id: 'ritem-1', orderId: 'rtn-1', productId: 'prod-1', variantId: null, comboId: null, quantity: 2, price: 100, sourceWarehouseId: 'wh-1', sourceOrderItemId: 'item-1', product: { id: 'prod-1', name: 'P' }, combo: null }],
    };
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-1', status: 'RETURN_PENDING' };
    const store = await setup({ order, rtn, dispatch });

    const result = await service.finalizeDispatchReturn('dsp-1', actor);

    expect(result.outcome).toBe('returned');
    expect(result.dispatch.status).toBe('RETURNED');
    expect(result.order.status).toBe('Delivered');
    expect(result.rtn.status).toBe('Returned');
    expect(result.restoredItems).toEqual([{ productId: 'prod-1', variantId: null, quantity: 2 }]);
    expect(cancelReturnStock.restoreForReturnOrder).toHaveBeenCalledTimes(1);
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    expect(store.orders.find((o) => o.id === 'rtn-1').stockRestored).toBe(true);
  });

  it('full return: original Return Pending → Returned + restoreForOrder, no RTN needed', async () => {
    const order = makePartialOrder({
      status: { id: 'status-rp', name: 'Return Pending', nextStatuses: ['status-returned'] },
      statusId: 'status-rp',
    });
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'steadfast', consignmentId: 'CONS-2', status: 'RETURN_PENDING' };
    const store = await setup({ order, dispatch });

    const result = await service.finalizeDispatchReturn('dsp-1', actor);

    expect(result.outcome).toBe('returned');
    expect(result.order.status).toBe('Returned');
    expect(result.rtn).toBeNull();
    expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', referencePrefix: 'return' }),
    );
  });

  it('full return heal: order Delivered (never advanced) still finalizes via Return Pending', async () => {
    const order = deliveredOrder();
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'redx', consignmentId: 'CONS-3', status: 'RETURN_PENDING' };
    await setup({ order, dispatch });

    const result = await service.finalizeDispatchReturn('dsp-1', actor);

    expect(result.outcome).toBe('returned');
    expect(result.order.status).toBe('Returned');
    expect(order.timeline.some((t: any) => t.status === 'Return Pending')).toBe(true);
    expect(order.timeline.some((t: any) => t.status === 'Returned')).toBe(true);
  });

  it('rejects an unresolved Partial order with the actionable message', async () => {
    const order = makePartialOrder(); // still Partial
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-4', status: 'RETURN_PENDING' };
    await setup({ order, dispatch });

    await expect(service.finalizeDispatchReturn('dsp-1', actor)).rejects.toThrow(
      'This Partial order has not been resolved into a Return Order yet.',
    );
    expect(dispatch.status).toBe('RETURN_PENDING');
  });

  it('rejects dispatches that cannot be returned from their current state', async () => {
    const order = deliveredOrder();
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-5', status: 'DISPATCHED' };
    await setup({ order, dispatch });

    await expect(service.finalizeDispatchReturn('dsp-1', actor)).rejects.toThrow(
      /cannot be marked Returned from its current state/,
    );
  });

  it('is idempotent: an already-settled return reports already_returned without mutation', async () => {
    const order = makePartialOrder({
      status: { id: 'status-returned', name: 'Returned', nextStatuses: [] },
      statusId: 'status-returned',
    });
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-6', status: 'RETURNED' };
    await setup({ order, dispatch });

    const result = await service.finalizeDispatchReturn('dsp-1', actor);

    expect(result.outcome).toBe('already_returned');
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForReturnOrder).not.toHaveBeenCalled();
  });

  it('loses the race safely: claim count 0 → already_returned, no mutation', async () => {
    const order = deliveredOrder();
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-7', status: 'RETURN_PENDING' };
    const store = await setup({ order, dispatch });
    // Another actor settled it first.
    store.dispatches[0].status = 'RETURNED';
    order.status = { id: 'status-returned', name: 'Returned', nextStatuses: [] };
    order.statusId = 'status-returned';

    const result = await service.finalizeDispatchReturn('dsp-1', actor);

    expect(result.outcome).toBe('already_returned');
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
  });

  it('throws NotFound for a missing dispatch', async () => {
    const order = deliveredOrder();
    await setup({ order, dispatch: { id: 'dsp-x', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-X', status: 'RETURN_PENDING' } });
    await expect(service.finalizeDispatchReturn('dsp-missing', actor)).rejects.toThrow(NotFoundException);
  });

  it('refuses to full-heal a PARTIAL dispatch (no phantom restore of delivered goods)', async () => {
    const order = deliveredOrder();
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-P', status: 'PARTIAL' };
    await setup({ order, dispatch });

    await expect(service.finalizeDispatchReturn('dsp-1', actor)).rejects.toThrow(
      /cannot be marked Returned from its current state/,
    );
    // Nothing restored, nothing mutated — part of the goods actually shipped.
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    expect(dispatch.status).toBe('PARTIAL');
    expect(order.statusId).toBe('status-delivered');
  });

  it('still heals a RETURNED dispatch whose order was never advanced', async () => {
    const order = deliveredOrder();
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-R', status: 'RETURNED' };
    await setup({ order, dispatch });

    const result = await service.finalizeDispatchReturn('dsp-1', actor);

    expect(result.outcome).toBe('returned');
    expect(result.order.status).toBe('Returned');
    expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledTimes(1);
  });

  it('full return with damage: restores good units only and persists the Return row', async () => {
    const order = makePartialOrder({
      status: { id: 'status-rp', name: 'Return Pending', nextStatuses: ['status-returned'] },
      statusId: 'status-rp',
    });
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'steadfast', consignmentId: 'CONS-D1', status: 'RETURN_PENDING' };
    const store = await setup({
      order,
      dispatch,
      items: [
        { id: 'item-1', orderId: 'order-1', productId: 'prod-1', variantId: null, quantity: 2, sourceWarehouseId: 'wh-1' },
      ],
    });

    const result = await service.finalizeDispatchReturn('dsp-1', actor, [
      { productId: 'prod-1', variantId: null, quantity: 2, damagedQuantity: 1 },
    ]);

    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        items: [expect.objectContaining({ productId: 'prod-1', quantity: 2, damagedQuantity: 1 })],
      }),
    );
    expect(result.restoredItems).toEqual([
      { productId: 'prod-1', variantId: null, quantity: 1, damagedQuantity: 1 },
    ]);
    expect(store.returns).toHaveLength(1);
    expect(store.returns[0].items[0]).toMatchObject({
      productId: 'prod-1',
      quantity: 2,
      damagedQuantity: 1,
    });
    expect(store.returns[0].items[0].damageLog[0]).toMatchObject({
      qty: 1,
      phase: 'receive',
      by: actor.email,
    });
    expect(store.returns[0].stockReconciled).toBe(true);
  });

  it('partial return with damage: passes the damage map to the RTN restore and persists it', async () => {
    const order = deliveredOrder();
    const rtn = {
      id: 'rtn-1', displayId: 'RTN-260930-0001', kind: 'RETURN', returnOfOrderId: 'order-1',
      statusId: 'status-return-pending', status: { id: 'status-return-pending', name: 'Return Pending' },
      stockRestored: false, returnedAt: null, timeline: [],
      items: [{ id: 'ritem-1', orderId: 'rtn-1', productId: 'prod-1', variantId: null, comboId: null, quantity: 2, price: 100, sourceWarehouseId: 'wh-1', sourceOrderItemId: 'item-1', product: { id: 'prod-1', name: 'P' }, combo: null }],
    };
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-D2', status: 'RETURN_PENDING' };
    const store = await setup({ order, rtn, dispatch });

    const result = await service.finalizeDispatchReturn('dsp-1', actor, [
      { productId: 'prod-1', variantId: null, quantity: 2, damagedQuantity: 1 },
    ]);

    const call = (cancelReturnStock.restoreForReturnOrder as jest.Mock).mock.calls[0][0];
    expect(call.damageByKey.get('prod-1::')).toBe(1);
    expect(result.restoredItems).toEqual([
      { productId: 'prod-1', variantId: null, quantity: 1, damagedQuantity: 1 },
    ]);
    expect(store.returns[0].items[0]).toMatchObject({ damagedQuantity: 1 });
  });

  it('rejects damage above the returned line quantity before any stock write', async () => {
    const order = makePartialOrder({
      status: { id: 'status-rp', name: 'Return Pending', nextStatuses: ['status-returned'] },
      statusId: 'status-rp',
    });
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'redx', consignmentId: 'CONS-D3', status: 'RETURN_PENDING' };
    await setup({
      order,
      dispatch,
      items: [{ id: 'item-1', orderId: 'order-1', productId: 'prod-1', variantId: null, quantity: 2 }],
    });

    await expect(
      service.finalizeDispatchReturn('dsp-1', actor, [
        { productId: 'prod-1', variantId: null, quantity: 2, damagedQuantity: 3 },
      ]),
    ).rejects.toThrow(/exceeds the returned quantity/i);
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
  });
});

describe('RtnService — restoreForReturnOrder idempotency', () => {
  it('does not restore twice: the stockRestored flag gates re-runs', async () => {
    const order = deliveredOrder();
    const rtn = {
      id: 'rtn-1', displayId: 'RTN-260930-0001', kind: 'RETURN', returnOfOrderId: 'order-1',
      statusId: 'status-returned', status: { id: 'status-returned', name: 'Returned' },
      stockRestored: true, returnedAt: new Date(), timeline: [],
      items: [],
    };
    const dispatch = { id: 'dsp-1', orderId: 'order-1', courier: 'pathao', consignmentId: 'CONS-8', status: 'RETURNED' };
    const fake = makePrismaFake({ order, items: [], dispatches: [dispatch], rtnOrders: [rtn] });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RtnService,
        { provide: PrismaService, useValue: fake.prisma },
        { provide: StockService, useValue: STOCK_STUB },
        { provide: OrdersService, useValue: { recalculate: () => ({ subtotal: 0, total: 0 }) } },
        { provide: OrdersEventService, useValue: { emit: jest.fn() } },
        { provide: DispatchService, useValue: {} },
        { provide: CancelReturnStockService, useValue: {
          restoreForOrder: jest.fn(),
          restoreForReturnOrder: jest.fn().mockResolvedValue({ restored: false }),
        } },
        { provide: CacheService, useValue: { invalidateByPrefix: jest.fn() } },
      ],
    }).compile();
    const svc = module.get(RtnService);
    const cancelReturnStock = module.get(CancelReturnStockService);

    const result = await svc.finalizeDispatchReturn('dsp-1', actor);
    expect(result.outcome).toBe('already_returned');
    expect(cancelReturnStock.restoreForReturnOrder).not.toHaveBeenCalled();
  });
});
