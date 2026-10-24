import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { DiscountsService } from './discounts.service';
import {
  CreateDiscountDto,
  EvaluateDiscountsDto,
  UpdateDiscountDto,
} from './dto/discount.dto';

// Same feature flag as coupons: the admin menu is one "Coupons &
// Discounts" entry, and discounts ride the coupons license surface.
@Controller('discounts')
@RequiresFeature('admin_coupons')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Roles('superadmin', 'admin', 'employee')
  @Get()
  async findAll() {
    return this.discountsService.findAll();
  }

  // Storefront cart/checkout evaluate automatic discounts for display —
  // public like coupon validation; the order-creation hook recomputes
  // server-side, so this endpoint can never change what is charged.
  @Public()
  @Post('evaluate')
  async evaluate(@Body() dto: EvaluateDiscountsDto) {
    return this.discountsService.evaluateForCart(dto);
  }

  @Public()
  @Get('active')
  async findActive() {
    return this.discountsService.findActiveSummaries();
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.discountsService.findOne(id);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get(':id/applications')
  async findApplications(@Param('id') id: string) {
    return this.discountsService.findApplications(id);
  }

  @Roles('superadmin', 'admin')
  @Post()
  async create(@Body() dto: CreateDiscountDto) {
    return this.discountsService.create(dto);
  }

  @Roles('superadmin', 'admin')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDiscountDto) {
    return this.discountsService.update(id, dto);
  }

  @Roles('superadmin', 'admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.discountsService.remove(id);
  }
}
