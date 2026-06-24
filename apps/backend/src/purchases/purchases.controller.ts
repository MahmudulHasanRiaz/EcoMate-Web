import { Controller, Get, Post, Body, Param, Put, Delete, Patch, Query } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { PurchaseStatus } from '@prisma/client';

@Controller('purchases')
@Roles('superadmin', 'admin', 'manager')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  create(@Body() createPurchaseDto: CreatePurchaseDto) {
    return this.purchasesService.create(createPurchaseDto);
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.purchasesService.findAll(
      page ? parseInt(page, 10) : undefined,
      perPage ? parseInt(perPage, 10) : undefined,
      status,
      supplierId,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchasesService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updatePurchaseDto: UpdatePurchaseDto) {
    return this.purchasesService.update(id, updatePurchaseDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.purchasesService.remove(id);
  }

  @Post(':id/receive')
  receiveItems(
    @Param('id') id: string,
    @Body() body: { items: { itemId: string; receivedQty: number }[] },
  ) {
    return this.purchasesService.receiveItems(id, body.items);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: PurchaseStatus },
  ) {
    return this.purchasesService.updateStatus(id, body.status);
  }
}
