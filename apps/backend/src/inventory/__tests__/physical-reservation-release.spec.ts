import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PhysicalInventoryController } from '../physical-inventory.controller';
import { StockService } from '../../stock/stock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { InventoryEnabledGuard } from '../../stock/inventory-enabled.guard';

/**
 * DELETE /inventory/physical/reservations/:id must stamp the ACTING user on
 * every release leg (2026-11-03): the managed legs hard-coded 'system' and
 * the physical leg stamped nobody, so a manual release was untraceable.
 */
describe('PhysicalInventoryController — reservation release actor', () => {
  let controller: PhysicalInventoryController;
  let stockService: {
    getPhysicalRecord: jest.Mock;
    releasePhysical: jest.Mock;
    operate: jest.Mock;
  };
  let prisma: any;

  const user = { email: 'staff@ecomate.com' };

  beforeEach(async () => {
    stockService = {
      getPhysicalRecord: jest.fn().mockResolvedValue(null),
      releasePhysical: jest.fn().mockResolvedValue(undefined),
      operate: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      orderItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      orderItemComboComponent: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      // Run the callback against the same stub so tx.* resolves.
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PhysicalInventoryController],
      providers: [
        { provide: StockService, useValue: stockService },
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: { invalidateByPrefix: jest.fn() } },
        { provide: InventoryEnabledGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(InventoryEnabledGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PhysicalInventoryController);
  });

  it('stamps the acting user on the physical release leg', async () => {
    stockService.getPhysicalRecord.mockResolvedValue({
      productId: 'p-1',
      warehouseId: 'wh-1',
      reservedQuantity: 4,
    });

    await controller.releaseReservation('rec-1', user);

    expect(stockService.releasePhysical).toHaveBeenCalledWith(
      expect.objectContaining({ performedBy: 'staff@ecomate.com', quantity: 4 }),
    );
  });

  it('stamps the acting user on the managed OrderItem release leg', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 'oi-1',
      productId: 'p-1',
      variantId: null,
      quantity: 2,
      managedStockReserved: true,
      order: { displayId: 'ORD-1' },
    });

    await controller.releaseReservation('oi-1', user);

    expect(stockService.operate).toHaveBeenCalledWith(
      'release',
      expect.objectContaining({
        performedBy: 'staff@ecomate.com',
        ledgerType: 'CANCEL_RELEASE',
      }),
    );
  });

  it('stamps the acting user on the combo-component release leg', async () => {
    prisma.orderItemComboComponent.findUnique.mockResolvedValue({
      id: 'cc-1',
      productId: 'p-1',
      variantId: null,
      totalQuantity: 3,
      managedStockReserved: true,
      orderItem: { order: { displayId: 'ORD-2' } },
    });

    await controller.releaseReservation('cc-1', user);

    expect(stockService.operate).toHaveBeenCalledWith(
      'release',
      expect.objectContaining({
        performedBy: 'staff@ecomate.com',
        ledgerType: 'CANCEL_RELEASE',
        quantity: 3,
      }),
    );
  });

  it('still 404s when no reservation exists in any leg', async () => {
    await expect(controller.releaseReservation('nope', user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(stockService.releasePhysical).not.toHaveBeenCalled();
    expect(stockService.operate).not.toHaveBeenCalled();
  });
});
