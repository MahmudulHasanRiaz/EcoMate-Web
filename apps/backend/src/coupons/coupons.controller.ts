import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

@Controller('coupons')
@RequiresFeature('admin_coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get() async findAll() {
    return this.couponsService.findAll();
  }

  @Get('validate')
  async validate(
    @Query('code') code: string,
    @Query('userId') userId?: string,
  ) {
    if (!code) throw new BadRequestException('Coupon code is required');
    return this.couponsService.validate(code, userId);
  }

  @Roles('superadmin', 'admin')
  @Post()
  async create(@Body() dto: CreateCouponDto) {
    return this.couponsService.create(dto);
  }

  @Roles('superadmin', 'admin')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.couponsService.update(id, dto);
  }

  @Roles('superadmin', 'admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.couponsService.remove(id);
  }

  @Roles('superadmin', 'admin')
  @Get(':id/usage')
  async getUsage(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.couponsService.getUsage(
      id,
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
    );
  }
}
