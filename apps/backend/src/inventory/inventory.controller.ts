import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('low-stock')
  async lowStock() {
    return this.inventoryService.lowStock();
  }

  @Get('logs')
  async logs(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('type') type?: string,
  ) {
    return this.inventoryService.logs(
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
      type,
    );
  }

  @Post('adjust')
  async adjust(
    @Body() body: { productId: string; quantity: number; reason: string; performedBy?: string },
  ) {
    return this.inventoryService.adjust(
      body.productId,
      body.quantity,
      body.reason,
      body.performedBy,
    );
  }

  @Post('bulk-adjust')
  async bulkAdjust(
    @Body() body: { items: { productId: string; quantity: number; reason: string }[]; performedBy?: string },
  ) {
    return this.inventoryService.bulkAdjust(body.items, body.performedBy);
  }
}
