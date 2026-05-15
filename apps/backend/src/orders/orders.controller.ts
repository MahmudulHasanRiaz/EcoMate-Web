import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderStatusDto, UpdateOrderDto, UpdateOrderItemDto } from './dto/order.dto';
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

  @Put(':id')
  updateOrder(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.svc.updateOrder(id, dto);
  }

  @Put(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto, @CurrentUser() user: { userId: string }) {
    return this.svc.updateStatus(id, dto, user.userId);
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: UpdateOrderItemDto) {
    return this.svc.addItem(id, dto);
  }

  @Delete(':id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.svc.removeItem(id, itemId);
  }

  @Post(':id/note')
  addNote(@Param('id') id: string, @Body() dto: { note: string; visibility: 'public' | 'private' }, @CurrentUser() user: { userId: string }) {
    return this.svc.addNote(id, dto.note, dto.visibility, user.userId);
  }
}
