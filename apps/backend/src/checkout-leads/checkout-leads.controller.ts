import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { CheckoutLeadsService } from './checkout-leads.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Throttle } from '@nestjs/throttler';
import { ConvertOrderDto } from './dto/convert-order.dto';
import { UpsertLeadDto } from './dto/upsert-lead.dto';

@Controller('checkout-leads')
export class CheckoutLeadsController {
  constructor(private readonly svc: CheckoutLeadsService) {}

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_checkout_leads')
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      search,
      status,
      assignedToId,
      sort,
      order,
    });
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_checkout_leads')
  @Get('summary')
  summary() {
    return this.svc.getSummary();
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_checkout_leads')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Public()
  @Post()
  upsert(@Body() dto: UpsertLeadDto) {
    return this.svc.upsert({
      phone: dto.phone,
      name: dto.name,
      email: dto.email,
      address: dto.address,
      items: dto.items,
      payload: dto.payload,
      paymentMethod: dto.paymentMethod,
      fingerprint: dto.fingerprint,
      fbp: dto.fbp,
      fbc: dto.fbc,
    });
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_checkout_leads')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.updateStatus(id, status, user?.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_checkout_leads')
  @Patch(':id/assign')
  assign(
    @Param('id') id: string,
    @Body('assignedToId') assignedToId: string | null,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.assign(id, assignedToId, user.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_checkout_leads')
  @Post(':id/convert')
  convert(
    @Param('id') id: string,
    @Body() dto: ConvertOrderDto,
    @CurrentUser() user: { userId: string },
    @Req() req: any,
  ) {
    const clientIp = req?.ip || req?.socket?.remoteAddress || '';
    return this.svc.convertToOrder(id, user.userId, dto, clientIp);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_checkout_leads')
  @Post('bulk/assign')
  bulkAssign(
    @Body('ids') ids: string[],
    @Body('assignedToId') assignedToId: string | null,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.bulkAssign(ids, assignedToId, user.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_checkout_leads')
  @Post('bulk/status')
  bulkStatus(@Body('ids') ids: string[], @Body('status') status: string) {
    return this.svc.bulkStatus(ids, status);
  }
}
