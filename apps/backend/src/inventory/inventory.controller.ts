import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdjustInventoryDto, BulkAdjustInventoryDto } from './dto/adjust-inventory.dto';
import { ValuationQueryDto, StockTransferDto } from './dto/valuation.dto';

@Controller('inventory')
@RequiresFeature('admin_inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get('low-stock')
  async lowStock() {
    return this.inventoryService.lowStock();
  }

  @Roles('superadmin', 'admin', 'manager')
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

  @Roles('superadmin', 'admin', 'manager')
  @Get('stock-overview')
  async stockOverview(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('type') type?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.inventoryService.stockOverview({
      page: page ? parseInt(page) : 1,
      perPage: perPage ? parseInt(perPage) : 20,
      search,
      categoryId,
      type,
      sortBy,
      sortOrder: sortOrder as 'asc' | 'desc' | undefined,
    });
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('adjust')
  async adjust(
    @Body() body: AdjustInventoryDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.inventoryService.adjust(
      body.productId,
      body.quantity,
      body.reason,
      user.email,
      body.variantId,
      body.comboId,
    );
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk-adjust')
  async bulkAdjust(
    @Body() body: BulkAdjustInventoryDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.inventoryService.bulkAdjust(body.items, user.email);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('valuation')
  async valuation(@Query() query: ValuationQueryDto) {
    return this.inventoryService.valuation(query);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('transfer')
  async transfer(
    @Body() body: StockTransferDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.inventoryService.transfer(body, user.email);
  }
}
