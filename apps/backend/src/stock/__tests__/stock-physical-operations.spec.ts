import { ConflictException } from '@nestjs/common';
import { StockService } from '../stock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { CostingLotService } from '../costing-lot.service';

/**
 * Physical-inventory movement integrity.
 *
 * Three invariants are locked in here:
 *  · A decrement is GUARDED — two concurrent movements out of the same bin can
 *    never both succeed and drive the row negative.
 *  · `deduct` only releases a hold when the deduction CONSUMES a reservation. A
 *    transfer moves stock that was never reserved, so it must leave
 *    reservedQuantity alone (the column going negative would inflate the
 *    available quantity every availability check computes).
 *  · The ledger records the row that was REALLY changed — before/after come
 *    from the write itself, not from a separate read that can land elsewhere.
 */
describe('StockService — physical inventory operations', () => {
  let service: StockService;
  let tx: any;
  let cache: { invalidateByPrefix: jest.Mock };

  const PI_ROW = {
    id: 'pi-1',
    productId: 'prod-1',
    variantId: 'var-1',
    warehouseId: 'w1',
    binLocationId: 'bin-1',
    quantity: 10,
    reservedQuantity: 4,
  };

  beforeEach(() => {
    cache = { invalidateByPrefix: jest.fn().mockResolvedValue(undefined) };
    // Stateful row: findFirst must reflect earlier writes in the same call, the
    // way a real database would. A constant mock made the second (reserved-only)
    // write re-read the ORIGINAL quantity, so the ledger's stockAfter looked
    // unchanged even though the row really had moved.
    let row = { ...PI_ROW };
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
        findFirst: jest.fn().mockImplementation(async () => ({ ...row })),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          for (const [field, delta] of Object.entries<any>(data)) {
            row[field] += delta[Object.keys(delta)[0]];
          }
          return {};
        }),
        updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
          for (const [field, delta] of Object.entries<any>(data)) {
            const op = Object.keys(delta)[0];
            const amount = delta[op];
            if (op === 'decrement' && row[field] < amount) return { count: 0 };
            row[field] += op === 'decrement' ? -amount : amount;
          }
          return { count: 1 };
        }),
        create: jest.fn().mockResolvedValue({ id: 'pi-new', binLocationId: null }),
      },
      physicalInventoryLedger: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new StockService(
      {} as any as PrismaService,
      cache as any as CacheService,
      {} as any as CostingLotService,
    );
  });

  /**
   * A factory, not a shared const: `tx` is rebuilt in every beforeEach, so a
   * captured reference would go stale.
   */
  const params = (overrides: Record<string, unknown> = {}) => ({
    productId: 'prod-1',
    variantId: 'var-1',
    warehouseId: 'w1',
    binLocationId: 'bin-1',
    quantity: 3,
    reference: 'ref-1',
    performedBy: 'admin@x.com',
    tx,
    ...overrides,
  });

  const ledgerRows = () =>
    tx.physicalInventoryLedger.create.mock.calls.map((c: any[]) => c[0].data);

  const writes = () =>
    tx.physicalInventory.updateMany.mock.calls.map((c: any[]) => c[0].data);

  describe('guarded decrement', () => {
    it('decrements through updateMany with a quantity >= qty predicate', async () => {
      await service.deductPhysical(params());

      expect(tx.physicalInventory.updateMany).toHaveBeenCalledWith({
        where: { id: 'pi-1', quantity: { gte: 3 } },
        data: { quantity: { decrement: 3 } },
      });
      // The unguarded single-row update is gone for decrements.
      expect(tx.physicalInventory.update).not.toHaveBeenCalled();
    });

    it('fails with 409 when the guard matches no row (a concurrent movement won)', async () => {
      // Row had 10, another transaction took 9 → only 1 left, we need 3.
      tx.physicalInventory.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.deductPhysical(params())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('reports the quantity actually available in the conflict message', async () => {
      tx.physicalInventory.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.deductPhysical(params())).rejects.toThrow(
        /only 10 available/,
      );
    });

    it('creates a missing row on an increment (no guard needed)', async () => {
      tx.physicalInventory.findFirst.mockResolvedValue(null);

      await service.addPhysical(params());

      expect(tx.physicalInventory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: 3, binLocationId: 'bin-1' }),
        }),
      );
      expect(tx.physicalInventory.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('reservation-aware deduct', () => {
    it('releases the hold on a SALE deduction (consumes a reservation by default)', async () => {
      await service.deductPhysical(params());

      expect(writes()).toEqual([
        { quantity: { decrement: 3 } },
        { reservedQuantity: { decrement: 3 } },
      ]);
      expect(tx.physicalInventory.updateMany).toHaveBeenCalledWith({
        where: { id: 'pi-1', reservedQuantity: { gte: 3 } },
        data: { reservedQuantity: { decrement: 3 } },
      });
    });

    it('leaves reservedQuantity untouched on a TRANSFER (consumesReservation: false)', async () => {
      await service.deductPhysical(params({ consumesReservation: false }));

      expect(writes()).toEqual([{ quantity: { decrement: 3 } }]);
    });

    it('leaves reservedQuantity untouched on a manual negative adjustment', async () => {
      await service.addPhysical(params({ quantity: -3 }));

      expect(writes()).toEqual([{ quantity: { decrement: 3 } }]);
    });
  });

  describe('ledger reflects the row that really changed', () => {
    it('records the actual before/after of the updated row', async () => {
      await service.deductPhysical(params({ quantity: 4 }));

      expect(ledgerRows()[0]).toMatchObject({
        productId: 'prod-1',
        variantId: 'var-1',
        warehouseId: 'w1',
        quantity: 4,
        direction: 'OUT',
        type: 'DEDUCTION',
        // the row held 10, we removed 4
        stockBefore: 10,
        stockAfter: 6,
      });
    });

    it('records the reserved transition of a reservation-consuming deduction', async () => {
      await service.deductPhysical(params({ quantity: 4 }));

      // reservedQuantity was 4; the deduction releases the hold it consumes.
      expect(ledgerRows()[0]).toMatchObject({
        stockBefore: 10,
        stockAfter: 6,
        reservedBefore: 4,
        reservedAfter: 0,
      });
    });

    it('leaves reservedBefore == reservedAfter on a transfer', async () => {
      await service.deductPhysical(
        params({
          quantity: 4,
          consumesReservation: false,
          ledgerType: 'TRANSFER_OUT',
        }),
      );

      expect(ledgerRows()[0]).toMatchObject({
        type: 'TRANSFER_OUT',
        stockBefore: 10,
        stockAfter: 6,
        reservedBefore: 4,
        reservedAfter: 4,
      });
    });

    it('does NOT re-query PhysicalInventory to reconstruct before/after', async () => {
      // A reservation-consuming deduct guards two fields (quantity, then
      // reservedQuantity) and each guarded write must read the row it is about
      // to update — so 2 lookups is the correct count. What this locks down is
      // that the LEDGER adds none of its own: the old code issued an extra
      // findFirst purely to rebuild before/after, which could report a
      // different row's values than the one it had just updated.
      await service.deductPhysical(params());

      expect(tx.physicalInventory.findFirst).toHaveBeenCalledTimes(2);
      expect(tx.physicalInventoryLedger.create).toHaveBeenCalledTimes(1);
    });

    it('emits ONE merged leg when a deduction touches quantity AND reservedQuantity', async () => {
      await service.deductPhysical(params({ quantity: 4 }));

      // Two guarded updates (quantity, then reservedQuantity) but a single
      // ledger row — a second row would double-count the movement.
      expect(tx.physicalInventory.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.physicalInventoryLedger.create).toHaveBeenCalledTimes(1);
    });

    it('logs a created row as 0 → quantity, not as a negative before', async () => {
      tx.physicalInventory.findFirst.mockResolvedValue(null);

      await service.addPhysical(params({ quantity: 5 }));

      expect(ledgerRows()[0]).toMatchObject({
        quantity: 5,
        direction: 'IN',
        stockBefore: 0,
        stockAfter: 5,
        reservedBefore: 0,
        reservedAfter: 0,
      });
    });

    it('does not invent a binLocationId column on the ledger row', async () => {
      // The ledger is keyed warehouse-wide; the bin lives on the row that was
      // changed (carried in the change snapshot), not on the ledger.
      await service.addPhysical(params({ quantity: 2 }));

      expect(ledgerRows()[0]).not.toHaveProperty('binLocationId');
    });
  });

  describe('availability guards still apply', () => {
    it('refuses a movement for an ALWAYS_IN_STOCK product', async () => {
      tx.product.findUnique.mockResolvedValue({ availabilityMode: 'ALWAYS_IN_STOCK' });

      await expect(service.deductPhysical(params())).rejects.toThrow(
        /always in stock/i,
      );
      expect(tx.physicalInventory.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a movement for an ALWAYS_OUT_OF_STOCK product', async () => {
      tx.product.findUnique.mockResolvedValue({
        availabilityMode: 'ALWAYS_OUT_OF_STOCK',
      });

      await expect(service.deductPhysical(params())).rejects.toThrow(
        /always out of stock/i,
      );
    });
  });
});