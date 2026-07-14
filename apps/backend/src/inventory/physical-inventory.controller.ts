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

    return { ok: true };
  }

  @Roles('superadmin', 'admin', 'manager')
  @UseGuards(InventoryEnabledGuard)
  @Get('reservations')
  async reservations(
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.stockService.listReservations(warehouseId, productId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @UseGuards(InventoryEnabledGuard)
  @Delete('reservations/:id')
  async releaseReservation(@Param('id') id: string) {
    const record = await this.stockService.getPhysicalRecord(id);
    if (!record) throw new NotFoundException('Reservation not found');
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
}