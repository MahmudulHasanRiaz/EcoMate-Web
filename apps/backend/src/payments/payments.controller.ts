import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, VerifyPaymentDto } from '../orders/dto/order.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_payments')
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('gatewayCode') gatewayCode?: string,
    @Query('status') status?: string,
    @Query('orderId') orderId?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      gatewayCode,
      status,
      orderId,
    });
  }

  @Public()
  @Post(':orderId')
  create(@Param('orderId') orderId: string, @Body() dto: CreatePaymentDto) {
    return this.svc.create(orderId, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_payments')
  @Put(':id/verify')
  verify(
    @Param('id') id: string,
    @Body() dto: VerifyPaymentDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.verify(id, dto, user.userId);
  }
}
