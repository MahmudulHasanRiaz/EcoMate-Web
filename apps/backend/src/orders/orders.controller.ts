import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private readonly svc: OrdersService) {}

  @Get()
  findAll(@Query('page') page?: string, @Query('perPage') perPage?: string, @Query('search') search?: string, @Query('statusId') statusId?: string, @Query('sort') sort?: string, @Query('order') order?: string) {
    return this.svc.findAll({ page: page ? parseInt(page) : undefined, perPage: perPage ? parseInt(perPage) : undefined, search, statusId, sort, order });
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() dto: CreateOrderDto) { return this.svc.create(dto); }

  @Put(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto, @CurrentUser() user: { userId: string }) {
    return this.svc.updateStatus(id, dto, user.userId);
  }
}
