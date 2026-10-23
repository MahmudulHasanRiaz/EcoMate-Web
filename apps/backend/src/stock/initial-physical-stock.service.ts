import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { StockRouterService } from './stock-router.service';
import { StockService } from './stock.service';

export interface InitialPhysicalUnit {
  variantId?: string;
  quantity: number;
}

/**
 * B4: with Inventory Management ON, confirming a MANAGED_STOCK order allocates
 * PHYSICAL stock, so units that exist only in the managed counter can never be
 * confirmed — the product is orderable but unconfirmable, silently.
 *
 * Every creation entry point (product form, draft publish, CSV import) seeds
 * the physical layer through this ONE helper, so a new product with initial
 * stock either gets its physical record or the creation fails loudly. The
 * physical record is what makes the stock reachable: order confirmation falls
 * back to the first PhysicalInventory row when neither the order payload nor
 * the product carries a warehouse (orders.service.ts physical allocation).
 */
@Injectable()
export class InitialPhysicalStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly stockRouter: StockRouterService,
    private readonly stockService: StockService,
  ) {}

  /**
   * Warehouse that will hold the initial units. Resolved BEFORE any row is
   * written so a missing warehouse fails the whole request instead of leaving
   * behind a product that can be ordered but never fulfilled.
   */
  async resolveWarehouse(
    avMode: string,
    initialStock: number,
    dtoWarehouseId?: string | null,
  ): Promise<string | null> {
    if (avMode !== 'MANAGED_STOCK' || initialStock <= 0) return null;
    if (!(await this.stockRouter.isInventoryManagementEnabled())) return null;

    if (dtoWarehouseId) {
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: dtoWarehouseId },
        select: { id: true, isActive: true },
      });
      if (!warehouse || !warehouse.isActive) {
        throw new BadRequestException(
          'The selected warehouse does not exist or is inactive — initial stock cannot be placed there.',
        );
      }
      return warehouse.id;
    }

    const warehouse =
      (await this.prisma.warehouse.findFirst({
        where: { isActive: true, type: 'main' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })) ??
      (await this.prisma.warehouse.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }));
    if (warehouse) return warehouse.id;

    throw new BadRequestException(
      'Inventory Management is enabled and this product has initial stock, but no active warehouse exists. ' +
        'Activate a warehouse (or pass warehouseId) before saving — otherwise orders can be placed but never confirmed.',
    );
  }

  /**
   * Adds the initial units to the physical layer. `productWarehouseId` is the
   * product's CURRENT warehouse; pass null when it is known to be unset so the
   * resolved warehouse is also persisted on the product (matching the product
   * form's behaviour).
   */
  async mirrorUnits(params: {
    productId: string;
    productWarehouseId: string | null;
    warehouseId: string | null;
    units: InitialPhysicalUnit[];
    reference: string;
    performedBy?: string;
  }): Promise<void> {
    const {
      productId,
      productWarehouseId,
      warehouseId,
      units,
      reference,
      performedBy,
    } = params;
    if (!warehouseId) return;

    const seeded = units.filter((unit) => (unit.quantity || 0) > 0);
    if (seeded.length === 0) return;

    if (productWarehouseId === null) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { warehouseId },
      });
    }

    for (const unit of seeded) {
      await this.stockService.operatePhysical('add', {
        productId,
        variantId: unit.variantId,
        warehouseId,
        quantity: unit.quantity,
        reference,
        performedBy: performedBy || 'system',
        ledgerType: 'INITIAL',
      });
    }
    await this.cache.invalidateByPrefix('product:');
  }
}
