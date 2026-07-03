import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Query,
} from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { CreateGrnDto } from './dto/create-grn.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('purchases')
@Roles('superadmin', 'admin', 'manager')
@RequiresFeature('admin_purchases')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  create(@Body() dto: CreatePurchaseDto) {
    return this.purchasesService.create(dto);
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
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseDto) {
    return this.purchasesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.purchasesService.remove(id);
  }

  @Post(':id/grn')
  createGrn(
    @Param('id') id: string,
    @Body() dto: CreateGrnDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.purchasesService.createGrn(id, dto, user?.userId);
  }

  @Get(':id/grns')
  getGrns(@Param('id') id: string) {
    return this.purchasesService.getGrns(id);
  }

  @Get('grn/:grnId')
  getGrn(@Param('grnId') grnId: string) {
    return this.purchasesService.getGrn(grnId);
  }
}
