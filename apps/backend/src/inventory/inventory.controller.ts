import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('inventory')
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
    @Body()
    body: {
      productId?: string;
      variantId?: string;
      comboId?: string;
      quantity: number;
      reason: string;
      performedBy?: string;
    },
    @CurrentUser() user: { email: string },
  ) {
    const performedBy = body.performedBy || user.email;
    delete body.performedBy;
    return this.inventoryService.adjust(
      body.productId,
      body.quantity,
      body.reason,
      performedBy,
      body.variantId,
      body.comboId,
    );
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk-adjust')
  async bulkAdjust(
    @Body()
    body: {
      items: {
        productId?: string;
        variantId?: string;
        comboId?: string;
        quantity: number;
        reason: string;
      }[];
      performedBy?: string;
    },
    @CurrentUser() user: { email: string },
  ) {
    return this.inventoryService.bulkAdjust(body.items, user.email);
  }
}
