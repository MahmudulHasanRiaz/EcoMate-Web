import { Controller, Get, Post, Delete, Body, Param, Query, NotFoundException, BadRequestException, UseGuards } from '@nestjs/common';
import { StockService } from '../stock/stock.service';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { InventoryEnabledGuard } from '../stock/inventory-enabled.guard';
import { RequiresFeature } from '@ecomate/feature-flags';
import { AdjustPhysicalDto, BulkAdjustPhysicalDto, BulkAdjustPhysicalItemDto } from './dto/physical-inventory.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('inventory/physical')
@RequiresFeature('admin_inventory')
export class PhysicalInventoryController {
  constructor(
    private readonly stockService: StockService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles('superadmin', 'admin', 'manager')
  @UseGuards(InventoryEnabledGuard)
  @Get()
  async list(
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('binLocationId') binLocationId?: string,
  ) {
    return this.stockService.listPhysical(productId, warehouseId, binLocationId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @UseGuards(InventoryEnabledGuard)
  @Post('adjust')
  async adjust(
    @Body() dto: AdjustPhysicalDto,
    @CurrentUser() user: { email: string },
  ) {
    // Validate: positive adjustment requires unitCost
    if (dto.quantity > 0 && (!dto.unitCost || dto.unitCost <= 0)) {
      throw new NotFoundException('Unit cost is required when adding stock');
    }

    // Reject product-level adjustment for variable parent products
    if (!dto.variantId && dto.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { type: true },
      });
      if (product?.type === 'variable') {
        throw new BadRequestException(
          'Variable products use variant-level stock management. Select a specific variant instead.',
        );
      }
    }

    await this.stockService.addPhysical({
      productId: dto.productId,
      variantId: dto.variantId,
      warehouseId: dto.warehouseId,
      quantity: dto.quantity,
      reference: dto.reason,
      ledgerType: 'PHYSICAL_ADJUSTMENT',
      binLocationId: dto.binLocationId,
      unitCost: dto.unitCost,
      performedBy: user.email,
    });

    // Create CostingLot for positive adjustment
    if (dto.quantity > 0 && dto.unitCost) {
      await this.stockService.createCostingLotForAdjustment({
        productId: dto.productId,
        variantId: dto.variantId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        unitCost: dto.unitCost,
        reference: dto.reason,
      });
    }

    // Consume FIFO CostingLots for negative adjustment
    if (dto.quantity < 0) {
      await this.stockService.deductCostingLotsForAdjustment({
        productId: dto.productId,
        variantId: dto.variantId,
        warehouseId: dto.warehouseId,
        quantity: Math.abs(dto.quantity),
      });
    }

    // syncManagedStock: if the product is MANAGED_STOCK with syncManagedStock=ON,
    // physical adjustment should also mirror the total physical quantity into managedStockQuantity.
    // For INVENTORY_CONTROLLED products this is not needed — physical inventory IS the storefront source.
    const productId = dto.productId || (dto.variantId
      ? (await this.prisma.productVariant.findUnique({ where: { id: dto.variantId }, select: { productId: true } }))?.productId
      : undefined);

    if (productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { availabilityMode: true, syncManagedStock: true },
      });

      if (product?.availabilityMode === 'MANAGED_STOCK' && product.syncManagedStock) {
        // Recompute total physical quantity for this product+variant across all warehouses/bins
        if (dto.variantId) {
          const agg = await this.prisma.physicalInventory.aggregate({
            where: { productId, variantId: dto.variantId },
            _sum: { quantity: true },
          });
          await this.prisma.productVariant.update({
            where: { id: dto.variantId },
            data: { managedStockQuantity: agg._sum.quantity ?? 0 },
          });
        } else {
          const agg = await this.prisma.physicalInventory.aggregate({
            where: { productId, variantId: null },
            _sum: { quantity: true },
          });
          await this.prisma.product.update({
            where: { id: productId },
            data: { managedStockQuantity: agg._sum.quantity ?? 0 },
          });
        }
      }
    }

    return { ok: true };
  }

  @Roles('superadmin', 'admin', 'manager')
  @UseGuards(InventoryEnabledGuard)
  @Post('bulk-adjust')
  async bulkAdjust(
    @Body() dto: BulkAdjustPhysicalDto,
    @CurrentUser() user: { email: string },
  ) {
    const hasPositive = dto.items.some(i => i.quantity > 0);
    const hasNegative = dto.items.some(i => i.quantity < 0);
    if (hasPositive && hasNegative) {
      throw new BadRequestException('Cannot mix positive and negative adjustments in the same request');
    }

    for (const item of dto.items) {
      if (item.quantity > 0) {
        if (!item.unitCost || item.unitCost <= 0) {
          throw new BadRequestException(`Unit cost is required when adding stock`);
        }
      }
    }

    // Reject product-level adjustment for variable parent products
    for (const item of dto.items) {
      if (!item.variantId && item.productId) {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId },
          select: { type: true },
        });
        if (product?.type === 'variable') {
          throw new BadRequestException(
            'Variable products use variant-level stock management. Select a specific variant instead.',
          );
        }
      }
    }

    for (const item of dto.items) {
      await this.stockService.addPhysical({
        productId: item.productId,
        variantId: item.variantId,
        warehouseId: dto.warehouseId,
        quantity: item.quantity,
        reference: dto.reason,
        ledgerType: 'PHYSICAL_ADJUSTMENT',
        binLocationId: item.binLocationId,
        unitCost: item.unitCost,
        performedBy: user.email,
      });

      if (item.quantity > 0 && item.unitCost) {
        await this.stockService.createCostingLotForAdjustment({
          productId: item.productId,
          variantId: item.variantId,
          warehouseId: dto.warehouseId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          reference: dto.reason,
        });
      }

      if (item.quantity < 0) {
        await this.stockService.deductCostingLotsForAdjustment({
          productId: item.productId,
          variantId: item.variantId,
          warehouseId: dto.warehouseId,
          quantity: Math.abs(item.quantity),
        });
      }
    }

    // syncManagedStock: for each unique product+variant adjusted, if MANAGED_STOCK + syncManagedStock=ON,
    // recompute managedStockQuantity from total physical inventory.
    const seenKeys = new Set<string>();
    for (const item of dto.items) {
      const resolvedProductId = item.productId || (item.variantId
        ? (await this.prisma.productVariant.findUnique({ where: { id: item.variantId }, select: { productId: true } }))?.productId
        : undefined);
      if (!resolvedProductId) continue;

      const key = `${resolvedProductId}|${item.variantId || ''}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const product = await this.prisma.product.findUnique({
        where: { id: resolvedProductId },
        select: { availabilityMode: true, syncManagedStock: true },
      });

      if (product?.availabilityMode === 'MANAGED_STOCK' && product.syncManagedStock) {
        if (item.variantId) {
          const agg = await this.prisma.physicalInventory.aggregate({
            where: { productId: resolvedProductId, variantId: item.variantId },
            _sum: { quantity: true },
          });
          await this.prisma.productVariant.update({
            where: { id: item.variantId },
            data: { managedStockQuantity: agg._sum.quantity ?? 0 },
          });
        } else {
          const agg = await this.prisma.physicalInventory.aggregate({
            where: { productId: resolvedProductId, variantId: null },
            _sum: { quantity: true },
          });
          await this.prisma.product.update({
            where: { id: resolvedProductId },
            data: { managedStockQuantity: agg._sum.quantity ?? 0 },
          });
        }
      }
    }

    return { ok: true };
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('reservations')
  async reservations(
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.stockService.listReservations(warehouseId, productId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Delete('reservations/:id')
  async releaseReservation(@Param('id') id: string) {
    // 1. Try physical inventory reservation record
    const record = await this.stockService.getPhysicalRecord(id);
    if (record) {
      if (record.reservedQuantity <= 0) {
        return { ok: true, message: 'No active reservation to release' };
      }
      await this.stockService.releasePhysical({
        productId: record.productId,
        warehouseId: record.warehouseId,
        quantity: record.reservedQuantity,
        reference: 'manual-release',
      });
      return { ok: true };
    }

    // 2. Try managed stock reservation (OrderItem)
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id },
      include: { order: true },
    });
    if (orderItem && orderItem.managedStockReserved) {
      await this.prisma.$transaction(async (tx) => {
        await this.stockService.operate('release', {
          productId: orderItem.productId!,
          variantId: orderItem.variantId ?? undefined,
          quantity: orderItem.quantity,
          reference: `Manual release: ${orderItem.order.displayId}`,
          performedBy: 'system',
          tx,
          ledgerType: 'CANCEL_RELEASE',
        });
        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: { managedStockReserved: false },
        });
      });
      return { ok: true };
    }

    // 3. Try managed stock reservation (OrderItemComboComponent)
    const comp = await this.prisma.orderItemComboComponent.findUnique({
      where: { id },
      include: { orderItem: { include: { order: true } } },
    });
    if (comp && comp.managedStockReserved) {
      await this.prisma.$transaction(async (tx) => {
        await this.stockService.operate('release', {
          productId: comp.productId,
          variantId: comp.variantId ?? undefined,
          quantity: comp.totalQuantity,
          reference: `Manual release: ${comp.orderItem.order.displayId}`,
          performedBy: 'system',
          tx,
          ledgerType: 'CANCEL_RELEASE',
        });
        await tx.orderItemComboComponent.update({
          where: { id: comp.id },
          data: { managedStockReserved: false },
        });
      });
      return { ok: true };
    }

    throw new NotFoundException('Reservation not found');
  }
}