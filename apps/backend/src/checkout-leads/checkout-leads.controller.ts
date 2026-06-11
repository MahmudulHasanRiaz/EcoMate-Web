import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { CheckoutLeadsService } from './checkout-leads.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ConvertOrderDto } from './dto/convert-order.dto';

@Controller('checkout-leads')
export class CheckoutLeadsController {
  constructor(private readonly svc: CheckoutLeadsService) {}

  @Roles('superadmin', 'admin', 'manager')
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
  @Get('summary')
  summary() {
    return this.svc.getSummary();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Public()
  @Post()
  upsert(
    @Body()
    dto: {
      phone?: string;
      name?: string;
      email?: string;
      address?: any;
      items?: any;
      payload?: any;
      paymentMethod?: string;
      fingerprint?: string;
    },
  ) {
    return this.svc.upsert(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.updateStatus(id, status, user?.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Patch(':id/assign')
  assign(
    @Param('id') id: string,
    @Body('assignedToId') assignedToId: string | null,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.assign(id, assignedToId, user.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post(':id/convert')
  convert(
    @Param('id') id: string,
    @Body() dto: ConvertOrderDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.convertToOrder(id, user.userId, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk/assign')
  bulkAssign(
    @Body('ids') ids: string[],
    @Body('assignedToId') assignedToId: string | null,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.bulkAssign(ids, assignedToId, user.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk/status')
  bulkStatus(@Body('ids') ids: string[], @Body('status') status: string) {
    return this.svc.bulkStatus(ids, status);
  }
}
