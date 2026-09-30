import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PhysicalInventoryController } from '../physical-inventory.controller';
import { StockService } from '../../stock/stock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryEnabledGuard } from '../../stock/inventory-enabled.guard';
import { CacheService } from '../../cache/cache.service';

const PRODUCT = 'prod-1';
const VARIANT = 'var-1';
const SHOWROOM = 'wh-showroom';

describe('PhysicalInventoryController — destructive adjustment guard', () => {
  let controller: PhysicalInventoryController;
  let prisma: {
    physicalInventory: { findMany: jest.Mock };
    product: { findUnique: jest.Mock };
    productVariant: { findUnique: jest.Mock };
  };
  let addPhysical: jest.Mock;

  const build = async (currentQty: number, reserved = 0) => {
    prisma.physicalInventory.findMany.mockResolvedValue([
      { id: 'pi-1', quantity: currentQty, reservedQuantity: reserved },
    ]);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PhysicalInventoryController],
      providers: [
        { provide: StockService, useValue: { addPhysical, deductCostingLotsForAdjustment: jest.fn(), createCostingLotForAdjustment: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: { del: jest.fn(), get: jest.fn(), set: jest.fn(), invalidateByPrefix: jest.fn() } },
        { provide: InventoryEnabledGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(InventoryEnabledGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PhysicalInventoryController);
  };

  const user = { email: 'admin@ecomate.com' };

  beforeEach(() => {
    addPhysical = jest.fn().mockResolvedValue(undefined);
    prisma = {
      physicalInventory: { findMany: jest.fn() },
      product: { findUnique: jest.fn().mockResolvedValue(null) },
      productVariant: { findUnique: jest.fn().mockResolvedValue(null) },
    };
  });

  it('blocks a single adjustment that would wipe >=90% of a location (46 of 46)', async () => {
    await build(46);
    await expect(
      controller.adjust(
        {
          productId: PRODUCT,
          variantId: VARIANT,
          warehouseId: SHOWROOM,
          quantity: -46,
          reason: 'restore',
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(addPhysical).not.toHaveBeenCalled();
  });

  it('blocks a bulk adjust that would wipe a location without confirmation', async () => {
    await build(46);
    await expect(
      controller.bulkAdjust(
        {
          warehouseId: SHOWROOM,
          reason: 'restore',
          items: [{ productId: PRODUCT, variantId: VARIANT, quantity: -46 }],
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(addPhysical).not.toHaveBeenCalled();
  });

  it('allows the same wipe when the caller explicitly confirms it', async () => {
    await build(46);
    await expect(
      controller.adjust(
        {
          productId: PRODUCT,
          variantId: VARIANT,
          warehouseId: SHOWROOM,
          quantity: -46,
          reason: 'damaged goods written off',
          confirmDestructive: true,
        } as any,
        user,
      ),
    ).resolves.toBeDefined();
    expect(addPhysical).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: -46, warehouseId: SHOWROOM }),
    );
  });

  it('allows normal partial deductions and additions untouched', async () => {
    await build(100);
    await controller.adjust(
      {
        productId: PRODUCT,
        variantId: VARIANT,
        warehouseId: SHOWROOM,
        quantity: -5,
        reason: 'damaged',
      } as any,
      user,
    );
    expect(addPhysical).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: -5 }),
    );
  });

  it('treats reserved stock as unavailable when measuring the wipe', async () => {
    await build(100, 95); // 5 available, 95 reserved
    await expect(
      controller.adjust(
        {
          productId: PRODUCT,
          variantId: VARIANT,
          warehouseId: SHOWROOM,
          quantity: -5,
          reason: 'restore',
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(addPhysical).not.toHaveBeenCalled();
  });
});
