import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, VerifyPaymentDto } from '../orders/dto/order.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_payments')
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('gatewayCode') gatewayCode?: string,
    @Query('status') status?: string,
    @Query('orderId') orderId?: string,
    // D-B: staff search by order NUMBER (displayId). Resolved server-side;
    // unknown numbers 404 (see PaymentsService.findAll).
    @Query('orderNumber') orderNumber?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      gatewayCode,
      status,
      orderId,
      orderNumber,
    });
  }

  @Public()
  @RateLimitPolicy('checkout')
  @Post(':orderId')
  create(
    @Param('orderId') orderId: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: { userId: string; role?: string } | null | undefined,
  ) {
    // Staff recording on behalf of a customer: context-bound staff actor
    // (logged-in non-customer), exempt from the order-ownership gate and
    // eligible for S1 auto-verification inside the service.
    const isStaff = !!user?.userId && user?.role !== 'customer';
    return this.svc.create(orderId, dto, {
      userId: user?.userId,
      token: dto.token,
      isStaff,
    });
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_payments')
  @Permissions('approve_payments')
  @Put(':id/verify')
  verify(
    @Param('id') id: string,
    @Body() dto: VerifyPaymentDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.verify(id, dto, user.userId);
  }
}
