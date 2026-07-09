import { Controller, Get, Post, Delete, Body, Param, Query, NotFoundException } from '@nestjs/common';
import { StockService } from '../stock/stock.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { AdjustPhysicalDto } from './dto/physical-inventory.dto';

@Controller('inventory/physical')
@RequiresFeature('admin_inventory')
export class PhysicalInventoryController {
  constructor(private readonly stockService: StockService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get()
  async list(
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.stockService.listPhysical(productId, warehouseId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('adjust')
  async adjust(@Body() dto: AdjustPhysicalDto) {
    await this.stockService.addPhysical({
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      quantity: dto.quantity,
      reference: dto.reason,
      ledgerType: 'PHYSICAL_ADJUSTMENT',
    });
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