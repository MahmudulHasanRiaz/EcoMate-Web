import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
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

  @Permissions('view_discounts')
  @Get()
  async findAll() {
    return this.discountsService.findAll();
  }

  // Storefront cart/checkout evaluate automatic discounts for display —
  // public like coupon validation; the order-creation hook recomputes
  // server-side, so this endpoint can never change what is charged.
  @Public()
  @RateLimitPolicy('strict_public')
  @Post('evaluate')
  async evaluate(@Body() dto: EvaluateDiscountsDto) {
    return this.discountsService.evaluateForCart(dto);
  }

  @Public()
  @Get('active')
  async findActive() {
    return this.discountsService.findActiveSummaries();
  }

  @Permissions('view_discounts')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.discountsService.findOne(id);
  }

  @Permissions('view_discounts')
  @Get(':id/applications')
  async findApplications(@Param('id') id: string) {
    return this.discountsService.findApplications(id);
  }

  @Permissions('create_discounts')
  @Post()
  async create(@Body() dto: CreateDiscountDto) {
    return this.discountsService.create(dto);
  }

  @Permissions('edit_discounts')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDiscountDto) {
    return this.discountsService.update(id, dto);
  }

  @Permissions('delete_discounts')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.discountsService.remove(id);
  }
}
