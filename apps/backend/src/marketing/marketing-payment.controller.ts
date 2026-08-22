import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MarketingPaymentService } from './marketing-payment.service';
import {
  CreatePaymentDto,
  ReconcilePaymentDto,
} from './dto/marketing.dto';

@Roles('superadmin', 'admin')
@Controller('marketing/payments')
@RequiresFeature('marketing_attribution')
export class MarketingPaymentController {
  constructor(private readonly payment: MarketingPaymentService) {}

  @Post()
  create(@Body() dto: CreatePaymentDto, @CurrentUser() user?: any) {
    return this.payment.createPayment(dto, user?.sub);
  }

  @Get()
  list(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('adAccountId') adAccountId?: string,
    @Query('status') status?: string,
  ) {
    const p = this.parsePage(page, perPage);
    return this.payment.list(p.page, p.perPage, adAccountId, status as any);
  }

  @Get('credit-due')
  creditDuePosition(@Query('adAccountId') adAccountId?: string) {
    return this.payment.creditDuePosition(adAccountId);
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.payment.getById(id);
  }

  @Post(':id/reconcile')
  reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcilePaymentDto,
    @CurrentUser() user?: any,
  ) {
    return this.payment.reconcileSimple(id, dto, user?.sub);
  }

  @Post(':id/post')
  postToAccounting(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: any,
  ) {
    return this.payment.postToAccounting(id, user?.sub);
  }

  private parsePage(page?: string, perPage?: string) {
    const p = page ? parseInt(page, 10) : 1;
    const pp = perPage ? parseInt(perPage, 10) : 20;
    if (isNaN(p) || p < 1) throw new BadRequestException('Invalid page');
    if (isNaN(pp) || pp < 1) throw new BadRequestException('Invalid perPage');
    return { page: p, perPage: pp };
  }
}
