import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('refunds')
@RequiresFeature('admin_refunds')
export class RefundsController {
  constructor(private readonly svc: RefundsService) {}

  @Roles('superadmin', 'admin', 'employee')
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
    @Query('orderId') orderId?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      status,
      orderId,
    });
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  // Task 9 (D5): recording a refund moves money (Refund row + negative
  // ledger row, optionally an atomic cancel) — requires the approve
  // permission, same as payment verification.
  @Roles('superadmin', 'admin', 'employee')
  @Permissions('approve_payments')
  @Post()
  create(
    @Body() dto: CreateRefundDto,
    @CurrentUser() user?: { userId: string; email: string },
  ) {
    return this.svc.create(dto, user?.userId);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Permissions('approve_payments')
  @Put(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRefundStatusDto,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    return this.svc.updateStatus(id, dto, user.userId, user.email);
  }
}
