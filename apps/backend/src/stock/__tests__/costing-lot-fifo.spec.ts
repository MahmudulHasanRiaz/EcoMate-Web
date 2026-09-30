import { CostingLotService } from '../costing-lot.service';

/**
 * FIFO consumption integrity: a race must never drive remainingQty negative,
 * and a shortfall (movement without a cost basis) must be loud, not a silent
 * console.warn.
 */
describe('CostingLotService — FIFO consumption integrity', () => {
  const prisma: any = {
    costingLot: { findFirst: jest.fn(), updateMany: jest.fn() },
    costingLotConsumption: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new CostingLotService(prisma);

  const baseParams = {
    productId: 'p1',
    variantId: null,
    warehouseId: 'w1',
    type: 'FULFILLMENT' as any,
    referenceType: 'ORDER_ITEM',
    referenceId: 'oi-1',
  };

  beforeEach(() => jest.clearAllMocks());

  it('skips a lot that lost a concurrent race and consumes the next one', async () => {
    prisma.costingLot.findFirst
      .mockResolvedValueOnce({ id: 'lot-1', remainingQty: 5, unitCost: 10 })
      .mockResolvedValueOnce({ id: 'lot-2', remainingQty: 4, unitCost: 11 });
    prisma.costingLot.updateMany
      .mockResolvedValueOnce({ count: 0 }) // lot-1 drained by a concurrent tx
      .mockResolvedValueOnce({ count: 1 });
    prisma.costingLotConsumption.create.mockResolvedValue({});

    const consumed = await service.consumeFIFO({ ...baseParams, quantity: 4 });

    expect(consumed).toEqual([{ lotId: 'lot-2', quantity: 4, unitCost: 11 }]);
    // The failed lot is excluded from the retry query (no hot loop).
    expect(prisma.costingLot.findFirst.mock.calls[1][0].where.id).toEqual({
      notIn: ['lot-1'],
    });
  });

  it('decrements through a guarded updateMany so remainingQty can never go negative', async () => {
    prisma.costingLot.findFirst.mockResolvedValueOnce({
      id: 'lot-1',
      remainingQty: 5,
      unitCost: 10,
    });
    prisma.costingLot.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.costingLotConsumption.create.mockResolvedValue({});

    await service.consumeFIFO({ ...baseParams, quantity: 5 });

    expect(prisma.costingLot.updateMany).toHaveBeenCalledWith({
      where: { id: 'lot-1', remainingQty: { gte: 5 } },
      data: { remainingQty: { decrement: 5 } },
    });
  });

  it('logs the shortfall at ERROR level with the full reference', async () => {
    prisma.costingLot.findFirst.mockResolvedValueOnce(null);
    const errorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => {});

    const consumed = await service.consumeFIFOAggregated({
      ...baseParams,
      quantity: 7,
    });

    expect(consumed).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('shortfall 7'),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ORDER_ITEM:oi-1'),
    );
  });

  it('logs nothing when the lots fully cover the movement', async () => {
    prisma.costingLot.findFirst.mockResolvedValueOnce({
      id: 'lot-1',
      remainingQty: 10,
      unitCost: 10,
    });
    prisma.costingLot.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.costingLotConsumption.create.mockResolvedValue({});
    const errorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => {});

    const consumed = await service.consumeFIFO({ ...baseParams, quantity: 4 });

    expect(consumed).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
