import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SCAN_PURPOSE_HANDLERS, ScannerService } from './scanner.service';
import { HandedOverPurpose } from './purposes/handed-over.purpose';
import { ReturnPurpose } from './purposes/return.purpose';
import { OrderStatusPurpose } from './purposes/order-status.purpose';
import { StickerPrintPurpose } from './purposes/sticker-print.purpose';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { RtnService } from '../rtn/rtn.service';
import { OrdersService } from '../orders/orders.service';
import { normalizeScanIdentifier, resolveScanIdentifier } from './scanner-resolver';

const actor = { userId: 'user-1', email: 'staff@ecomate.com' };

function makePrismaFake(opts: {
  orders?: any[];
  dispatches?: any[];
  statuses?: any[];
}) {
  const orders = opts.orders ?? [];
  const dispatches = opts.dispatches ?? [];
  const statuses = opts.statuses ?? [
    { id: 'st-partial', name: 'Partial' },
    { id: 'st-delivered', name: 'Delivered' },
    { id: 'st-rp', name: 'Return Pending' },
    { id: 'st-returned', name: 'Returned' },
  ];
  const prisma = {
    orderStatus: { findMany: async () => statuses },
    order: {
      findUnique: async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null,
      findFirst: async ({ where }: any) => {
        const found =
          orders.find((o) => o.displayId.toLowerCase() === where.displayId.equals.toLowerCase()) ?? null;
        if (!found) return null;
        return { ...found, dispatches: dispatches.filter((d) => d.orderId === found.id) };
      },
    },
    dispatch: {
      findMany: async ({ where }: any) => {
        const core = (where.OR?.[0]?.consignmentId?.contains ?? '').toLowerCase();
        return dispatches.filter((d) => {
          const ids = [d.consignmentId, d.trackingCode].filter(Boolean).map((s: string) => s.toLowerCase());
          return ids.some((id) => id === core || id.includes(core));
        });
      },
      findUnique: async ({ where }: any) => dispatches.find((d) => d.id === where.id) ?? null,
    },
  };
  return { prisma: prisma as unknown as PrismaService, store: { orders, dispatches } };
}

const saleOrder = (overrides: any = {}) => ({
  id: 'order-1',
  displayId: 'ORD-260930-0001',
  kind: 'SALE',
  status: { id: 'st-shipping', name: 'Shipping', nextStatuses: ['st-delivered', 'st-partial'] },
  trashedAt: null,
  ...overrides,
});

const dispatchFor = (order: any, overrides: any = {}) => ({
  id: 'dsp-1',
  orderId: order.id,
  courier: 'pathao',
  consignmentId: 'CONS-100',
  trackingCode: 'TRK-100',
  status: 'DISPATCHED',
  order,
  ...overrides,
});

describe('scanner-resolver — normalizeScanIdentifier', () => {
  it('trims, uppercases and collapses whitespace', () => {
    expect(normalizeScanIdentifier('  ord-260930-0001 ')).toBe('ORD-260930-0001');
    expect(normalizeScanIdentifier('cons\u00A0 100')).toBe('CONS 100');
  });
});

describe('scanner-resolver — resolveScanIdentifier', () => {
  it('resolves an order number to its order', async () => {
    const order = saleOrder();
    const { prisma } = makePrismaFake({ orders: [order] });
    const outcome = await resolveScanIdentifier(prisma, 'ORD-260930-0001');
    expect(outcome.status).toBe('resolved');
    expect(outcome.order?.displayId).toBe('ORD-260930-0001');
    expect(outcome.order?.allowedStatuses.map((s: any) => s.name)).toEqual([
      'Delivered',
      'Partial',
    ]);
  });

  it('is case-insensitive for order numbers', async () => {
    const order = saleOrder();
    const { prisma } = makePrismaFake({ orders: [order] });
    const outcome = await resolveScanIdentifier(prisma, 'ord-260930-0001');
    expect(outcome.status).toBe('resolved');
  });

  it('returns selection_required when an order maps to multiple dispatches', async () => {
    const order = saleOrder();
    const d1 = dispatchFor(order, { id: 'dsp-1', consignmentId: 'CONS-1' });
    const d2 = dispatchFor(order, { id: 'dsp-2', consignmentId: 'CONS-2' });
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [d1, d2] });
    // Order-number resolution only sees order.dispatches via include — the
    // fake returns them through the order object.
    const orderWithDispatches = { ...order, dispatches: [d1, d2] };
    const { prisma: prisma2 } = makePrismaFake({ orders: [orderWithDispatches], dispatches: [d1, d2] });
    const outcome = await resolveScanIdentifier(prisma2, 'ORD-260930-0001');
    expect(outcome.status).toBe('selection_required');
    expect(outcome.dispatches).toHaveLength(2);
  });

  it('resolves a courier consignment identifier', async () => {
    const order = saleOrder();
    const d = dispatchFor(order, { consignmentId: 'SF-99881' });
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [d] });
    const outcome = await resolveScanIdentifier(prisma, 'sf 99881');
    expect(outcome.status).toBe('resolved');
    expect(outcome.dispatches[0].consignmentId).toBe('SF-99881');
    expect(outcome.dispatches[0].courier).toBe('pathao');
  });

  it('resolves a tracking code', async () => {
    const order = saleOrder();
    const d = dispatchFor(order, { trackingCode: 'TRK-777' });
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [d] });
    const outcome = await resolveScanIdentifier(prisma, 'trk-777');
    expect(outcome.status).toBe('resolved');
    expect(outcome.dispatches[0].trackingCode).toBe('TRK-777');
  });

  it('returns selection_required for ambiguous courier identifiers', async () => {
    const order = saleOrder();
    const d1 = dispatchFor(order, { id: 'dsp-1', courier: 'pathao', consignmentId: 'DUP-1' });
    const d2 = dispatchFor(order, { id: 'dsp-2', courier: 'redx', consignmentId: 'DUP-1' });
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [d1, d2] });
    const outcome = await resolveScanIdentifier(prisma, 'dup-1');
    expect(outcome.status).toBe('selection_required');
    expect(outcome.dispatches).toHaveLength(2);
  });

  it('returns not_found for unknown identifiers', async () => {
    const { prisma } = makePrismaFake({ orders: [], dispatches: [] });
    const outcome = await resolveScanIdentifier(prisma, 'NOPE-123');
    expect(outcome.status).toBe('not_found');
    expect(outcome.message).toContain('No dispatch found');
  });

  it('returns not_found for empty input', async () => {
    const { prisma } = makePrismaFake({ orders: [], dispatches: [] });
    const outcome = await resolveScanIdentifier(prisma, '   ');
    expect(outcome.status).toBe('not_found');
  });
});

describe('ScannerService — purpose registry', () => {
  let service: ScannerService;

  beforeEach(async () => {
    const { prisma } = makePrismaFake({ orders: [], dispatches: [] });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScannerService,
        { provide: PrismaService, useValue: prisma },
        { provide: DispatchService, useValue: { updateStatus: jest.fn() } },
        { provide: RtnService, useValue: { finalizeDispatchReturn: jest.fn() } },
        { provide: OrdersService, useValue: { updateStatus: jest.fn() } },
        HandedOverPurpose,
        ReturnPurpose,
        OrderStatusPurpose,
        StickerPrintPurpose,
        {
          provide: SCAN_PURPOSE_HANDLERS,
          useFactory: (...handlers: any[]) => handlers,
          inject: [HandedOverPurpose, ReturnPurpose, OrderStatusPurpose, StickerPrintPurpose],
        },
      ],
    }).compile();
    service = module.get(ScannerService);
  });

  it('lists all four purposes with labels', () => {
    const purposes = service.listPurposes();
    expect(purposes.map((p) => p.purpose)).toEqual([
      'DISPATCH_HANDED_OVER',
      'DISPATCH_RETURN',
      'ORDER_STATUS',
      'STICKER_PRINT',
    ]);
    expect(purposes.every((p) => p.label && p.description)).toBe(true);
  });

  it('rejects an unknown purpose', async () => {
    const result = await service.execute('NOPE' as any, { identifier: 'X' }, actor);
    expect(result.status).toBe('error');
  });
});

describe('HandedOverPurpose', () => {
  let purpose: HandedOverPurpose;
  let dispatchService: DispatchService;

  beforeEach(async () => {
    const order = saleOrder();
    const dispatch = dispatchFor(order, { status: 'DISPATCHED' });
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [dispatch] });
    dispatchService = { updateStatus: jest.fn().mockResolvedValue(dispatch) } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandedOverPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: DispatchService, useValue: dispatchService },
      ],
    }).compile();
    purpose = module.get(HandedOverPurpose);
  });

  it('executes DISPATCHED → HANDED_OVER through DispatchService', async () => {
    const result = await purpose.execute({ identifier: 'CONS-100', dispatchId: 'dsp-1' }, actor);
    expect(result.status).toBe('success');
    expect(result.newState).toBe('HANDED_OVER');
    expect(result.oldState).toBe('DISPATCHED');
    expect(dispatchService.updateStatus).toHaveBeenCalledWith('dsp-1', 'HANDED_OVER', actor.email);
  });

  it('returns a duplicate result for an already HANDED_OVER dispatch (no mutation)', async () => {
    const order = saleOrder();
    const dispatch = dispatchFor(order, { status: 'HANDED_OVER' });
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [dispatch] });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandedOverPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: DispatchService, useValue: dispatchService },
      ],
    }).compile();
    const p = module.get(HandedOverPurpose);
    const result = await p.execute({ identifier: 'CONS-100', dispatchId: 'dsp-1' }, actor);
    expect(result.status).toBe('duplicate');
    expect(result.message).toContain('already handed over');
    expect(dispatchService.updateStatus).not.toHaveBeenCalled();
  });

  it('rejects a dispatch that is not in a handover-eligible state', async () => {
    const order = saleOrder();
    const dispatch = dispatchFor(order, { status: 'IN_TRANSIT' });
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [dispatch] });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandedOverPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: DispatchService, useValue: dispatchService },
      ],
    }).compile();
    const p = module.get(HandedOverPurpose);
    const result = await p.execute({ identifier: 'CONS-100', dispatchId: 'dsp-1' }, actor);
    expect(result.status).toBe('error');
    expect(result.message).toContain('cannot be marked Handed Over');
    expect(dispatchService.updateStatus).not.toHaveBeenCalled();
  });
});

describe('ReturnPurpose', () => {
  let purpose: ReturnPurpose;
  let rtnService: RtnService;

  beforeEach(async () => {
    const order = saleOrder();
    const dispatch = dispatchFor(order, { status: 'RETURN_PENDING' });
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [dispatch] });
    rtnService = {
      finalizeDispatchReturn: jest.fn().mockResolvedValue({
        outcome: 'returned',
        dispatch: { id: 'dsp-1', consignmentId: 'CONS-100', courier: 'pathao', status: 'RETURNED', oldStatus: 'RETURN_PENDING' },
        order: { id: 'order-1', displayId: 'ORD-260930-0001', status: 'Delivered' },
        rtn: { id: 'rtn-1', displayId: 'RTN-260930-0001', status: 'Returned', itemCount: 0 },
        restoredItems: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
      }),
    } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: RtnService, useValue: rtnService },
      ],
    }).compile();
    purpose = module.get(ReturnPurpose);
  });

  it('maps a successful partial return to a success result with RTN details', async () => {
    const result = await purpose.execute({ identifier: 'CONS-100', dispatchId: 'dsp-1' }, actor);
    expect(result.status).toBe('success');
    expect(result.title).toBe('CONS-100 — Returned');
    expect(result.message).toContain('RTN-260930-0001');
    expect(result.message).toContain('restored to stock');
    expect(result.oldState).toBe('RETURN_PENDING');
    expect(result.newState).toBe('RETURNED');
    expect(result.details?.restoredItems).toHaveLength(1);
  });

  it('maps an already-settled return to a duplicate result', async () => {
    (rtnService.finalizeDispatchReturn as jest.fn).mockResolvedValue({
      outcome: 'already_returned',
      dispatch: { id: 'dsp-1', consignmentId: 'CONS-100', courier: 'pathao', status: 'RETURNED', oldStatus: 'RETURNED' },
      order: { id: 'order-1', displayId: 'ORD-260930-0001', status: 'Returned' },
      rtn: null,
      restoredItems: [],
    });
    const result = await purpose.execute({ identifier: 'CONS-100', dispatchId: 'dsp-1' }, actor);
    expect(result.status).toBe('duplicate');
    expect(result.message).toContain('already completed');
  });

  it('maps a business rejection (unresolved Partial) to an error result without mutation', async () => {
    (rtnService.finalizeDispatchReturn as jest.fn).mockRejectedValue(
      new BadRequestException('This Partial order has not been resolved into a Return Order yet.'),
    );
    const result = await purpose.execute({ identifier: 'CONS-100', dispatchId: 'dsp-1' }, actor);
    expect(result.status).toBe('error');
    expect(result.message).toBe('This Partial order has not been resolved into a Return Order yet.');
  });

  it('requires a dispatch selection when the identifier is ambiguous', async () => {
    const result = await purpose.execute({ identifier: 'CONS-100' }, actor);
    expect(result.status).toBe('error');
    expect(result.message).toContain('Select the dispatch');
  });
});

describe('OrderStatusPurpose', () => {
  let purpose: OrderStatusPurpose;
  let ordersService: OrdersService;

  beforeEach(async () => {
    const order = saleOrder();
    const dispatch = dispatchFor(order);
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [dispatch] });
    ordersService = {
      updateStatus: jest.fn().mockResolvedValue({
        id: 'order-1',
        status: { id: 'st-delivered', name: 'Delivered' },
      }),
    } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderStatusPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();
    purpose = module.get(OrderStatusPurpose);
  });

  it('executes a valid transition through OrdersService.updateStatus', async () => {
    const result = await purpose.execute(
      { identifier: 'ORD-260930-0001', orderId: 'order-1', targetStatusId: 'st-delivered' },
      actor,
    );
    expect(result.status).toBe('success');
    expect(result.oldState).toBe('Shipping');
    expect(result.newState).toBe('Delivered');
    expect(ordersService.updateStatus).toHaveBeenCalledWith(
      'order-1',
      { statusId: 'st-delivered', note: 'Scanner status update' },
      actor.userId,
      actor.email,
    );
  });

  it('surfaces state-machine rejections as error results (no scanner bypass)', async () => {
    (ordersService.updateStatus as jest.fn).mockRejectedValue(
      new BadRequestException('Cannot transition from "Partial" to "Delivered". Allowed: Return Pending'),
    );
    const result = await purpose.execute(
      { identifier: 'ORD-260930-0001', orderId: 'order-1', targetStatusId: 'st-delivered' },
      actor,
    );
    expect(result.status).toBe('error');
    expect(result.message).toContain('Cannot transition');
  });

  it('refuses to status-scan a Return Order', async () => {
    const order = saleOrder({ kind: 'RETURN', displayId: 'RTN-260930-0001' });
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [] });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderStatusPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();
    const p = module.get(OrderStatusPurpose);
    const result = await p.execute(
      { identifier: 'RTN-260930-0001', orderId: 'order-1', targetStatusId: 'st-returned' },
      actor,
    );
    expect(result.status).toBe('error');
    expect(result.message).toContain('Return Order');
    expect(ordersService.updateStatus).not.toHaveBeenCalled();
  });
});

describe('StickerPrintPurpose', () => {
  it('resolves an order and returns the existing sticker print URL', async () => {
    const order = saleOrder();
    const dispatch = dispatchFor(order);
    const { prisma } = makePrismaFake({ orders: [order], dispatches: [dispatch] });
    const module: TestingModule = await Test.createTestingModule({
      providers: [StickerPrintPurpose, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const purpose = module.get(StickerPrintPurpose);
    const result = await purpose.execute({ identifier: 'ORD-260930-0001' }, actor);
    expect(result.status).toBe('success');
    expect(result.details?.printUrl).toBe('/admin/op/print/sticker/order-1');
  });

describe('Scanner batch execution', () => {
  const actor = { userId: 'user-1', email: 'staff@ecomate.com' };

  it('ORDER_STATUS batch applies one target status to every queued order', async () => {
    const orders = [
      { id: 'o1', displayId: 'ORD-1', kind: 'SALE', trashedAt: null, status: { id: 's1', name: 'Shipping' } },
      { id: 'o2', displayId: 'ORD-2', kind: 'SALE', trashedAt: null, status: { id: 's1', name: 'Shipping' } },
    ]
    const prisma = {
      order: {
        findUnique: async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null,
      },
    }
    const updateStatus = jest.fn().mockImplementation(async (id: string) => ({
      id,
      status: { id: 'st-delivered', name: 'Delivered' },
    }))
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderStatusPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: { updateStatus } },
      ],
    }).compile()
    const purpose = module.get(OrderStatusPurpose)

    const result = await purpose.execute(
      { identifier: 'ORD-1', orderIds: ['o1', 'o2'], targetStatusId: 'st-delivered' },
      actor,
    )

    expect(result.status).toBe('success')
    expect(result.details?.succeeded).toBe(2)
    expect(result.details?.failed).toBe(0)
    expect(updateStatus).toHaveBeenCalledTimes(2)
    expect(updateStatus).toHaveBeenCalledWith(
      'o1',
      { statusId: 'st-delivered', note: 'Scanner batch status update' },
      actor.userId,
      actor.email,
    )
  });

  it('ORDER_STATUS batch reports per-order failures without blocking the rest', async () => {
    const orders = [
      { id: 'o1', displayId: 'ORD-1', kind: 'SALE', trashedAt: null, status: { id: 's1', name: 'Shipping' } },
      { id: 'o2', displayId: 'ORD-2', kind: 'SALE', trashedAt: null, status: { id: 's1', name: 'Shipping' } },
    ]
    const prisma = {
      order: {
        findUnique: async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null,
      },
    }
    const updateStatus = jest.fn().mockImplementation(async (id: string) => {
      if (id === 'o2') throw new Error('Cannot transition from "Shipping" to "Delivered"')
      return { id, status: { id: 'st-delivered', name: 'Delivered' } }
    })
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderStatusPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: { updateStatus } },
      ],
    }).compile()
    const purpose = module.get(OrderStatusPurpose)

    const result = await purpose.execute(
      { identifier: 'ORD-1', orderIds: ['o1', 'o2'], targetStatusId: 'st-delivered' },
      actor,
    )

    expect(result.status).toBe('warning')
    expect(result.details?.succeeded).toBe(1)
    expect(result.details?.failed).toBe(1)
    expect(result.details?.results.find((r: any) => r.orderId === 'o2').ok).toBe(false)
  });

  it('ORDER_STATUS batch refuses Return Orders', async () => {
    const orders = [
      { id: 'rtn-1', displayId: 'RTN-1', kind: 'RETURN', trashedAt: null, status: { id: 's2', name: 'Return Pending' } },
    ]
    const prisma = {
      order: {
        findUnique: async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null,
      },
    }
    const updateStatus = jest.fn()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderStatusPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: { updateStatus } },
      ],
    }).compile()
    const purpose = module.get(OrderStatusPurpose)

    const result = await purpose.execute(
      { identifier: 'RTN-1', orderIds: ['rtn-1'], targetStatusId: 'st-delivered' },
      actor,
    )

    expect(result.status).toBe('error')
    expect(updateStatus).not.toHaveBeenCalled()
  });

  it('DISPATCH_HANDED_OVER batch hands over every queued dispatch', async () => {
    const dispatch = { id: 'd1', consignmentId: 'CONS-1', courier: 'pathao', status: 'DISPATCHED' }
    const prisma = {
      dispatch: {
        findUnique: async ({ where }: any) => (where.id === 'd1' ? dispatch : null),
      },
    }
    const updateStatus = jest.fn().mockResolvedValue(dispatch)
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandedOverPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: DispatchService, useValue: { updateStatus } },
      ],
    }).compile()
    const purpose = module.get(HandedOverPurpose)

    const result = await purpose.execute(
      { identifier: 'CONS-1', dispatchIds: ['d1'] },
      actor,
    )

    expect(result.status).toBe('success')
    expect(result.details?.succeeded).toBe(1)
    expect(updateStatus).toHaveBeenCalledWith('d1', 'HANDED_OVER', actor.email)
  })
})
});
