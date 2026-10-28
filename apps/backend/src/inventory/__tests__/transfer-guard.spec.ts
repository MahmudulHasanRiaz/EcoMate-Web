import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InventoryService } from '../inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { InitialPhysicalStockService } from '../../stock/initial-physical-stock.service';
import { CostingLotService } from '../../stock/costing-lot.service';
import { CacheService } from '../../cache/cache.service';
import { ManagedStockLedgerService } from '../managed-stock-ledger.service';

/**
 * Transfer guards that prevent stock corruption.
 *
 * The variable-product guard is the important one: a product-level transfer of
 * a VARIABLE product writes PhysicalInventory rows with `variantId = NULL`
 * that no variant can ever consume — stock that shows up in the warehouse but
 * is invisible to (and undeductible by) every variant-level path. The lookup
 * endpoint refuses to offer such a parent as selectable, and this guard makes
 * the refusal real on the server, mirroring the physical-adjust path.
 */
describe('InventoryService — transfer guards', () => {
  let service: InventoryService;
  let prisma: PrismaService;

  const variableProduct = {
    id: 'prod-shirt',
    name: 'Cotton Shirt',
    type: 'variable',
    availabilityMode: 'MANAGED_STOCK',
  };

  const simpleProduct = {
    id: 'prod-mug',
    name: 'Clay Mug',
    type: 'simple',
    availabilityMode: 'MANAGED_STOCK',
  };

  const baseDto = {
    productId: 'prod-shirt',
    sourceLocation: 'Main Warehouse',
    destinationLocation: 'Overflow',
    quantity: 1,
    idempotencyKey: 'k-1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: PrismaService,
          useValue: {
            product: { findUnique: jest.fn(), findFirst: jest.fn() },
            productVariant: { findUnique: jest.fn(), update: jest.fn() },
            warehouse: { findUnique: jest.fn().mockResolvedValue({ id: 'w1', name: 'Warehouse' }) },
            physicalInventory: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
            stockTransfer: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
            costingLot: { findFirst: jest.fn(), findMany: jest.fn() },
            // The real service runs its body inside $transaction; a mock that
            // never invokes the callback is enough to prove the guard let the
            // call through to that point.
            $transaction: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: StockService, useValue: {} },
        { provide: StockRouterService, useValue: {} },
        { provide: CostingLotService, useValue: {} },
        { provide: ManagedStockLedgerService, useValue: {} },
        { provide: CacheService, useValue: {} },
        {
          provide: InitialPhysicalStockService,
          useValue: { resolveWarehouse: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('refuses a product-level transfer of a VARIABLE product', async () => {
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(variableProduct);

    await expect(service.transfer({ ...baseDto } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.transfer({ ...baseDto } as any),
    ).rejects.toThrow(/variant/i);
  });

  it('never reaches the write path for a variable product — no orphan rows', async () => {
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(variableProduct);

    await expect(service.transfer({ ...baseDto } as any)).rejects.toThrow();

    // The whole point: nothing was persisted.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
    expect(prisma.physicalInventory.updateMany).not.toHaveBeenCalled();
  });

  it('allows the same transfer once a variantId is supplied', async () => {
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(variableProduct);
    (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue({
      id: 'var-1',
      productId: 'prod-shirt',
    });
    (prisma.stockTransfer.findUnique as jest.Mock).mockResolvedValue(null);

    // Reaching the transaction proves the variant guard let it through. Any
    // failure after that point belongs to the movement itself, not the guard.
    let err: unknown = null;
    await service
      .transfer({ ...baseDto, variantId: 'var-1' } as any)
      .catch((e) => {
        err = e;
      });

    expect((err as Error)?.message ?? '').not.toMatch(/variant/i);
  });

  it('refuses a variantId that belongs to a different product', async () => {
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(variableProduct);
    (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue({
      id: 'var-other',
      productId: 'prod-other',
      sku: 'OTHER-1',
    });

    await expect(
      service.transfer({ ...baseDto, variantId: 'var-other' } as any),
    ).rejects.toThrow(/does not belong/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still allows a product-level transfer for a SIMPLE product', async () => {
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(simpleProduct);
    (prisma.stockTransfer.findUnique as jest.Mock).mockResolvedValue(null);

    let err: unknown = null;
    await service
      .transfer({ ...baseDto, productId: 'prod-mug' } as any)
      .catch((e) => {
        err = e;
      });

    expect((err as Error)?.message ?? '').not.toMatch(/variant/i);
  });
});