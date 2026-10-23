import { Test, TestingModule } from '@nestjs/testing';
import { ReturnsService } from '../returns.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';

/**
 * Return/Exchange hardening (1): SHARED ELIGIBILITY GUARD.
 *
 * assertReturnEligible(orderId, {type, items}) rejects with 4xx when:
 *  (a) FULL && any active return exists
 *  (b) PARTIAL && an active FULL exists
 *  (c) PARTIAL && every ordered line is already fully returned
 *  (d) a requested line exceeds ordered − already-returned
 *  (e) order status ∉ {Shipping, Partial, Delivered}
 * plus a 60s duplicate guard (same order+items+type → 409).
 *
 * RED phase: the guard does not exist yet — every test below fails.
 */
describe('ReturnsService — shared eligibility guard (hardening 1)', () => {
  let service: ReturnsService;
  let prisma: any;

  const line = (productId: string, quantity: number, variantId: string | null = null) => ({
    productId,
    variantId,
    quantity,
  });

  function makeOrder(over: any = {}) {
    return {
      id: 'order-1',
      displayId: 'ORD-260101-0001',
      trashedAt: null,
      status: { id: 'st-shipping', name: 'Shipping' },
      items: [line('prod-1', 2), line('prod-2', 1)],
      ...over,
    };
  }

  function setup(opts: {
    order?: any;
    active?: any[];
    recent?: any[];
    products?: any[] | null;
  }) {
    const order = opts.order ?? makeOrder();
    const active = opts.active ?? [];
    const recent = opts.recent ?? [];
    const tx = {
      returnCounter: {
        upsert: jest.fn().mockImplementation(({ create }: any) =>
          Promise.resolve({ date: '260101', seq: create?.seq ?? 1 }),
        ),
      },
      return: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-new', displayId: 'RTN-260101-0009', createdAt: new Date(), ...data }),
        ),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-new', ...data }),
        ),
        findUnique: jest.fn().mockResolvedValue(null),
        // Courier upsert link-first lookup inside its transaction.
        findFirst: jest.fn((...args: any[]) => prisma.return.findFirst(...args)),
        findMany: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.createdAt) return recent;
          return active;
        }),
      },
      // §5 mark-original-delivered (partial returns): status write + timeline.
      order: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn((...args: any[]) => prisma.order.findUnique(...args)),
      },
      product: {
        findMany: jest.fn((...args: any[]) =>
          prisma.product?.findMany ? prisma.product.findMany(...args) : Promise.resolve([]),
        ),
      },
      orderStatus: {
        findUnique: jest.fn().mockResolvedValue({ id: 'st-delivered', name: 'Delivered' }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      return: {
        create: tx.return.create,
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.createdAt) return recent;
          return active;
        }),
        update: tx.return.update,
      },
      refund: { findUnique: jest.fn().mockResolvedValue({ id: 'refund-1' }) },
      dispatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    if (opts.products !== null) {
      prisma.product = {
        findMany: jest.fn().mockResolvedValue(
          opts.products ?? [
            { id: 'prod-1', name: 'Widget' },
            { id: 'prod-2', name: 'Gadget' },
          ],
        ),
      };
    }
    return { prisma, tx };
  }

  async function build(opts: Parameters<typeof setup>[0] = {}) {
    setup(opts);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CancelReturnStockService,
          useValue: { restoreForReturnItems: jest.fn().mockResolvedValue({ restored: [] }) },
        },
      ],
    }).compile();
    service = module.get<ReturnsService>(ReturnsService);
  }

  const ret = (over: any = {}) => ({
    id: 'ret-1',
    displayId: 'RTN-260101-0001',
    orderId: 'order-1',
    type: 'FULL',
    status: 'REQUESTED',
    source: 'STAFF',
    items: [],
    stockReconciled: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });

  it('(a) FULL with any active return → 400 naming the active return', async () => {
    await build({ active: [ret()] });
    await expect(
      service.create({ orderId: 'order-1', type: 'FULL' }),
    ).rejects.toThrow(
      'Order already has an active return RTN-260101-0001; close or cancel it first.',
    );
    expect(prisma.return.create).not.toHaveBeenCalled();
  });

  it('(b) PARTIAL with an active FULL → same 400', async () => {
    await build({ active: [ret({ type: 'FULL' })] });
    await expect(
      service.create({ orderId: 'order-1', type: 'PARTIAL', items: [line('prod-1', 1)] }),
    ).rejects.toThrow(
      'Order already has an active return RTN-260101-0001; close or cancel it first.',
    );
    expect(prisma.return.create).not.toHaveBeenCalled();
  });

  it('(c) PARTIAL when every line is already fully returned → Nothing left', async () => {
    await build({
      active: [
        ret({
          id: 'ret-p1',
          displayId: 'RTN-260101-0002',
          type: 'PARTIAL',
          items: [line('prod-1', 2), line('prod-2', 1)],
        }),
      ],
    });
    await expect(
      service.create({ orderId: 'order-1', type: 'PARTIAL', items: [line('prod-1', 1)] }),
    ).rejects.toThrow('Nothing left to return.');
    expect(prisma.return.create).not.toHaveBeenCalled();
  });

  it('(d) requested qty beyond ordered − returned → Only X left', async () => {
    await build({
      active: [
        ret({
          id: 'ret-p1',
          displayId: 'RTN-260101-0002',
          type: 'PARTIAL',
          items: [line('prod-1', 1)],
        }),
      ],
    });
    await expect(
      service.create({ orderId: 'order-1', type: 'PARTIAL', items: [line('prod-1', 2)] }),
    ).rejects.toThrow('Only 1 left to return for Widget.');
    expect(prisma.return.create).not.toHaveBeenCalled();
  });

  it('(e) status outside Shipping/Partial/Delivered → ineligible', async () => {
    await build({ order: makeOrder({ status: { id: 'st-conf', name: 'Confirmed' } }) });
    await expect(
      service.create({ orderId: 'order-1', type: 'FULL' }),
    ).rejects.toThrow(/not eligible for return.*Confirmed/);
    expect(prisma.return.create).not.toHaveBeenCalled();
  });

  it('idempotency: same order+items within 60s → 409 duplicate', async () => {
    await build({
      recent: [
        ret({
          id: 'ret-dup',
          displayId: 'RTN-260101-0005',
          type: 'PARTIAL',
          items: [line('prod-1', 1)],
          createdAt: new Date(Date.now() - 30_000),
        }),
      ],
    });
    await expect(
      service.create({ orderId: 'order-1', type: 'PARTIAL', items: [line('prod-1', 1)] }),
    ).rejects.toThrow(/Duplicate return request.*RTN-260101-0005/);
    expect(prisma.return.create).not.toHaveBeenCalled();
  });

  it('idempotency: same items outside the 60s window → allowed', async () => {
    await build({
      recent: [
        ret({
          id: 'ret-old',
          displayId: 'RTN-260101-0004',
          type: 'PARTIAL',
          items: [line('prod-1', 1)],
          createdAt: new Date(Date.now() - 61_000),
        }),
      ],
    });
    const created = await service.create({
      orderId: 'order-1',
      type: 'PARTIAL',
      items: [line('prod-1', 1)],
    });
    expect(created.displayId).toMatch(/^RTN-/);
    expect(prisma.return.create).toHaveBeenCalled();
  });

  it('PARTIAL coexists with an active PARTIAL while qty remains', async () => {
    await build({
      active: [
        ret({
          id: 'ret-p1',
          displayId: 'RTN-260101-0002',
          type: 'PARTIAL',
          items: [line('prod-1', 1)],
        }),
      ],
    });
    const created = await service.create({
      orderId: 'order-1',
      type: 'PARTIAL',
      items: [line('prod-1', 1)],
    });
    expect(created.displayId).toMatch(/^RTN-/);
  });

  it('EXCHANGE type skips the overlap guard (own lifecycle leg)', async () => {
    await build({ active: [ret({ type: 'FULL' })] });
    const created = await service.create({
      orderId: 'order-1',
      type: 'EXCHANGE',
      items: [line('prod-1', 1)],
    });
    expect(created.displayId).toMatch(/^RTN-/);
  });

  it('courier upsert LINKS the existing active Return instead of tripping the FULL guard', async () => {
    const activeReturn = ret({ type: 'FULL' });
    await build({ active: [activeReturn] });
    // findFirst resolves the active row (the shared lookup source above).
    prisma.return.findFirst.mockResolvedValue(activeReturn);
    const upserted = await service.upsertCourierReturn({
      orderId: 'order-1',
      courier: 'steadfast',
      courierReturnId: 'CG-1',
      courierStatus: 'delivered_return_received',
    });
    // No duplicate row: the external fact lands on the existing Return.
    expect(upserted).toBeDefined();
    expect(prisma.return.create).not.toHaveBeenCalled();
    expect(prisma.return.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ret-1' } }),
    );
  });
});
