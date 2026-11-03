import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LedgerQueryDto } from '../dto/ledger-query.dto';
import { StockTransferDto } from '../dto/valuation.dto';
import { BulkAdjustPhysicalDto } from '../dto/physical-inventory.dto';

/**
 * DTO validation hardening (2026-11-03): enum-typed ledger filters,
 * non-empty transfer idempotency keys, and non-empty bulk-adjust items —
 * all previously passed validation and failed (or silently no-oped)
 * downstream.
 */
describe('inventory DTO hardening', () => {
  const errorProperties = async (cls: any, plain: any): Promise<string[]> => {
    const instance = plainToInstance(cls, plain);
    const errors = await validate(instance as object);
    return errors.map((e) => e.property);
  };

  describe('LedgerQueryDto', () => {
    it('accepts real Prisma enum values', async () => {
      await expect(
        errorProperties(LedgerQueryDto, {
          type: 'RESERVE',
          referenceType: 'ORDER',
        }),
      ).resolves.toEqual([]);
    });

    it('rejects values outside the enums (they used to reach Prisma as casts)', async () => {
      await expect(
        errorProperties(LedgerQueryDto, { type: 'TRANSFER_OUT' }),
      ).resolves.toContain('type');
      await expect(
        errorProperties(LedgerQueryDto, { referenceType: 'WIDGET' }),
      ).resolves.toContain('referenceType');
    });
  });

  describe('StockTransferDto idempotencyKey', () => {
    const base = {
      productId: 'p-1',
      sourceLocation: 'wh-1',
      destinationLocation: 'wh-2',
      quantity: 1,
    };

    it('allows a missing key (the server generates one)', async () => {
      await expect(errorProperties(StockTransferDto, base)).resolves.toEqual([]);
    });

    it('rejects an empty key — it would collapse into the first transfer', async () => {
      await expect(
        errorProperties(StockTransferDto, { ...base, idempotencyKey: '' }),
      ).resolves.toContain('idempotencyKey');
    });

    it('accepts a real key', async () => {
      await expect(
        errorProperties(StockTransferDto, { ...base, idempotencyKey: 'abc-123' }),
      ).resolves.toEqual([]);
    });
  });

  describe('BulkAdjustPhysicalDto items', () => {
    it('rejects an empty items array (it used to return ok:true doing nothing)', async () => {
      await expect(
        errorProperties(BulkAdjustPhysicalDto, {
          warehouseId: 'wh-1',
          reason: 'recount',
          items: [],
        }),
      ).resolves.toContain('items');
    });

    it('accepts a single item', async () => {
      await expect(
        errorProperties(BulkAdjustPhysicalDto, {
          warehouseId: 'wh-1',
          reason: 'recount',
          items: [{ productId: 'p-1', quantity: 1 }],
        }),
      ).resolves.toEqual([]);
    });
  });
});
