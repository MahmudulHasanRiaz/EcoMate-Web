import { Controller, Get, Patch, Delete, Body, Param, Query, NotFoundException } from '@nestjs/common';
import { StockService } from '../stock/stock.service';

@Controller('inventory/physical')
export class PhysicalInventoryController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  async list(@Query('productId') productId?: string, @Query('warehouseId') warehouseId?: string) {
    return this.stockService.listPhysical(productId, warehouseId);
  }

  @Patch('adjust')
  async adjust(@Body() dto: { productId: string; warehouseId: string; quantity: number; reason: string }) {
    await this.stockService.addPhysical({ productId: dto.productId, warehouseId: dto.warehouseId, quantity: dto.quantity, reference: dto.reason || 'manual-adjust' });
    return { ok: true };
  }

  @Get('reservations')
  async reservations(@Query('warehouseId') warehouseId?: string, @Query('productId') productId?: string) {
    return this.stockService.listReservations(warehouseId, productId);
  }

  @Delete('reservations/:id')
  async releaseReservation(@Param('id') id: string) {
    const record = await this.stockService.getPhysicalRecord(id);
    if (!record) throw new NotFoundException('Physical inventory record not found');
    await this.stockService.releasePhysical({ productId: record.productId, warehouseId: record.warehouseId, quantity: record.reservedQuantity, reference: 'manual-release' });
    return { ok: true };
  }
}
