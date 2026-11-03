import { BadRequestException } from '@nestjs/common';
import { StockService } from '../stock.service';

/**
 * Non-allocated physical reserve guard (inventory audit fix round, WS1
 * item 2). operatePhysical('reserve') used to increment reservedQuantity
 * unconditionally — and CREATE a row holding reserved > quantity when none
 * existed. A reservation may now only hold stock that exists and is not
 * already held, and a missing row is an error, never a phantom hold.
 */
describe('StockService — physical reserve guard', () => {
  let service: StockService;
  let tx: any;
  let row: any;

  beforeEach(() => {
    row = {
      id: 'pi-1',
      productId: 'prod-1',
      variantId: null,
      warehouseId: 'w1',
      binLocationId: null,
      quantity: 10,
      reservedQuantity: 4,
    };
    tx = {
      product: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ availabilityMode: 'INVENTORY_CONTROLLED' }),
      },
      productVariant: {
        findUnique: jest.fn().mockResolvedValue({ productId: 'prod-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      physicalInventory: {
        findFirst: jest.fn().mockImplementation(async () => (row ? { ...row } : null)),
        update: jest.fn().mockResolvedValue({}),
        // Compare-and-swap semantics: the claim only lands when the row's
        // reservedQuantity still equals the value in the WHERE clause.
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (where.reservedQuantity !== undefined && where.reservedQuantity !== row.reservedQuantity) {
            return { count: 0 };
          }
          for (const [field, delta] of Object.entries<any>(data)) {
            const op = Object.keys(delta)[0];
            row[field] += op === 'decrement' ? -delta[op] : delta[op];
          }
          return { count: 1 };
        }),
        create: jest.fn().mockResolvedValue({ id: 'pi-new', binLocationId: null }),
      },
      physicalInventoryLedger: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new StockService(
      {} as any,
      { invalidateByPrefix: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
  });

  const params = (overrides: Record<string, unknown> = {}) => ({
    productId: 'prod-1',
    warehouseId: 'w1',
    quantity: 3,
    reference: 'ref-1',
    performedBy: 'admin@x.com',
    tx,
    ...overrides,
  });

  it('reserves within availability (10 on hand, 4 held, ask 6)', async () => {
    await service.reservePhysical(params({ quantity: 6 }));

    expect(tx.physicalInventory.updateMany).toHaveBeenCalledWith({
      where: { id: 'pi-1', reservedQuantity: 4 },
      data: { reservedQuantity: { increment: 6 } },
    });
    expect(row.reservedQuantity).toBe(10);
    expect(tx.physicalInventoryLedger.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a reserve beyond availability (10 on hand, 4 held, ask 7)', async () => {
    await expect(service.reservePhysical(params({ quantity: 7 }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(row.reservedQuantity).toBe(4);
    expect(tx.physicalInventoryLedger.create).not.toHaveBeenCalled();
  });

  it('rejects a reserve against a missing row instead of creating reserved > quantity', async () => {
    row = null;
    await expect(service.reservePhysical(params())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.physicalInventory.create).not.toHaveBeenCalled();
  });

  it('still allows a plain add to create the row (receive before reserve)', async () => {
    row = null;
    await service.addPhysical(params({ quantity: 5 }));
    expect(tx.physicalInventory.create).toHaveBeenCalledTimes(1);
  });
});
