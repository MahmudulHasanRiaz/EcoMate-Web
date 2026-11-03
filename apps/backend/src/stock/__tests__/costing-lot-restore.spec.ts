import { Prisma } from '@prisma/client';
import { CostingLotService } from '../costing-lot.service';

/**
 * restoreForReturn integrity (inventory audit fix round, WS1 item 12):
 *  · A second call with the SAME returnReferenceId is a no-op — the first
 *    version re-walked the pool and restored the same units twice (or
 *    threw "insufficient consumption history" on an already-done restore).
 *  · A call interrupted mid-way resumes for the remainder only, topping up
 *    the existing restoration row (the (consumptionId, returnReferenceId)
 *    unique key forbids a second row).
 *  · When the caller identifies the returned order's own consumptions
 *    (orderItemIds / cycleId), those are restored from FIRST — the exact
 *    cost basis of the units that went out — before the general pool.
 *  · FIFO consumption orders by receivedAt, then createdAt (item 11).
 */
describe('CostingLotService — restoreForReturn', () => {
  let prisma: any;
  let service: CostingLotService;

  const D = (n: number) => new Prisma.Decimal(n);

  const consumption = (overrides: Record<string, any> = {}) => ({
    id: 'cons-1',
    referenceId: 'oi-foreign',
    cycleId: null,
    quantity: 5,
    unitCost: D(10),
    restorations: [] as { quantity: number }[],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      costingLotRestoration: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      costingLotConsumption: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      costingLot: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      costingLotConsumptionCreate: undefined,
    };
    // consumeFIFO writes through costingLotConsumption.create
    prisma.costingLotConsumption.create = jest.fn().mockResolvedValue({});
    service = new CostingLotService(prisma);
  });

  const params = (overrides: Record<string, any> = {}) => ({
    returnReferenceId: 'RET-1',
    productId: 'p1',
    variantId: null,
    warehouseId: 'w1',
    returnQty: 3,
    ...overrides,
  });

  it('restores from the pool and writes a restoration + RET lot per batch', async () => {
    prisma.costingLotConsumption.findMany.mockResolvedValue([consumption()]);

    await service.restoreForReturn(params());

    expect(prisma.costingLotRestoration.create).toHaveBeenCalledTimes(1);
    expect(prisma.costingLotRestoration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        consumptionId: 'cons-1',
        returnReferenceId: 'RET-1',
        quantity: 3,
      }),
    });
    expect(prisma.costingLot.create).toHaveBeenCalledTimes(1);
    expect(prisma.costingLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 3, remainingQty: 3 }),
    });
  });

  it('is a no-op when the same returnReferenceId already restored the full quantity', async () => {
    prisma.costingLotRestoration.findMany.mockResolvedValue([
      { id: 'rest-1', consumptionId: 'cons-1', quantity: 3 },
    ]);

    await service.restoreForReturn(params());

    expect(prisma.costingLotConsumption.findMany).not.toHaveBeenCalled();
    expect(prisma.costingLotRestoration.create).not.toHaveBeenCalled();
    expect(prisma.costingLotRestoration.update).not.toHaveBeenCalled();
    expect(prisma.costingLot.create).not.toHaveBeenCalled();
  });

  it('resumes an interrupted restore: tops up the existing row and restores only the remainder', async () => {
    // First call restored 2 of 5 under RET-1, then died.
    prisma.costingLotRestoration.findMany.mockResolvedValue([
      { id: 'rest-1', consumptionId: 'cons-1', quantity: 2 },
    ]);
    prisma.costingLotConsumption.findMany.mockResolvedValue([
      consumption({ restorations: [{ quantity: 2 }] }),
    ]);

    await service.restoreForReturn(params({ returnQty: 5 }));

    // Remaining = 5 − 2 already restored = 3, applied as a top-up of the
    // existing row (a second create would violate the unique key).
    expect(prisma.costingLotRestoration.create).not.toHaveBeenCalled();
    expect(prisma.costingLotRestoration.update).toHaveBeenCalledWith({
      where: { id: 'rest-1' },
      data: { quantity: { increment: 3 } },
    });
    expect(prisma.costingLot.create).toHaveBeenCalledTimes(1);
    expect(prisma.costingLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 3, remainingQty: 3 }),
    });
  });

  it("prefers the returned order's OWN consumptions over newer foreign ones", async () => {
    const foreignNewer = consumption({
      id: 'cons-foreign',
      referenceId: 'oi-foreign',
      unitCost: D(99),
    });
    const ownOlder = consumption({
      id: 'cons-own',
      referenceId: 'oi-own',
      unitCost: D(10),
    });
    // Pool arrives newest-first (foreign first) — preference must reorder.
    prisma.costingLotConsumption.findMany.mockResolvedValue([foreignNewer, ownOlder]);

    await service.restoreForReturn(params({ orderItemIds: ['oi-own'] }));

    expect(prisma.costingLotRestoration.create).toHaveBeenCalledTimes(1);
    expect(prisma.costingLotRestoration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ consumptionId: 'cons-own', quantity: 3 }),
    });
  });

  it('prefers own consumptions by cycleId as well', async () => {
    const foreign = consumption({ id: 'cons-foreign', cycleId: 'cycle-x' });
    const own = consumption({ id: 'cons-own', cycleId: 'cycle-1', referenceId: 'oi-z' });
    prisma.costingLotConsumption.findMany.mockResolvedValue([foreign, own]);

    await service.restoreForReturn(params({ cycleId: 'cycle-1' }));

    expect(prisma.costingLotRestoration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ consumptionId: 'cons-own' }),
    });
  });

  it('still throws when the restorable pool genuinely cannot cover the return', async () => {
    prisma.costingLotConsumption.findMany.mockResolvedValue([
      consumption({ quantity: 2 }),
    ]);

    await expect(service.restoreForReturn(params({ returnQty: 5 }))).rejects.toThrow(
      /insufficient consumption history/,
    );
    expect(prisma.costingLotRestoration.create).not.toHaveBeenCalled();
  });
});

describe('CostingLotService — FIFO order tiebreak (item 11)', () => {
  it('consumeFIFO orders by receivedAt asc, then createdAt asc', async () => {
    const prisma: any = {
      costingLot: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
      costingLotConsumption: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    };
    const service = new CostingLotService(prisma);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

    await service.consumeFIFO({
      productId: 'p1',
      variantId: null,
      warehouseId: 'w1',
      quantity: 1,
      type: 'FULFILLMENT' as any,
      referenceType: 'ORDER_ITEM',
      referenceId: 'oi-1',
      allowShortfall: true,
    });

    expect(prisma.costingLot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      }),
    );
  });
});
