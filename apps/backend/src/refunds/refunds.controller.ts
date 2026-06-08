import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('refunds')
export class RefundsController {
  constructor(private readonly svc: RefundsService) {}

  @Roles('superadmin', 'admin', 'manager')
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

  @Roles('superadmin', 'admin', 'manager')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post()
  create(@Body() dto: CreateRefundDto) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Put(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRefundStatusDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.updateStatus(id, dto, user.userId);
  }
}
