import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Sse,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
} from './dto/order.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Observable, Subject } from 'rxjs';

@Controller('orders')
export class OrdersController {
  constructor(private readonly svc: OrdersService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('statusId') statusId?: string,
    @Query('courier') courier?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      search,
      statusId,
      courier,
      assignedToId,
      dateFrom,
      dateTo,
      sort,
      order,
    });
  }

  @Get(':id') findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }
  @Post() create(@Body() dto: CreateOrderDto) {
    return this.svc.create(dto);
  }
  @Put(':id') updateOrder(
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.svc.updateOrder(id, dto);
  }

  @Put(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.updateStatus(id, dto, user.userId);
  }

  @Post(':id/items') addItem(
    @Param('id') id: string,
    @Body() dto: UpdateOrderItemDto,
  ) {
    return this.svc.addItem(id, dto);
  }
  @Delete(':id/items/:itemId') removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.svc.removeItem(id, itemId);
  }
  @Post(':id/note') addNote(
    @Param('id') id: string,
    @Body() dto: { note: string; visibility: 'public' | 'private' },
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.addNote(id, dto.note, dto.visibility, user.userId);
  }

  @Post('bulk') async bulkOrders(@Body() dto: { ids: string[] }) {
    const orders = await this.svc.bulkOrders(dto.ids || []);
    return { orders };
  }
  @Post('bulk/status') async bulkStatus(
    @Body() dto: { ids: string[]; statusId: string },
  ) {
    return this.svc.bulkStatusChange(dto.ids, dto.statusId);
  }
  @Post('bulk/dispatch') async bulkDispatch(
    @Body() dto: { ids: string[]; courier: string },
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.bulkDispatch(dto.courier, dto.ids, user.userId);
  }
  @Post('bulk/assign') async bulkAssign(
    @Body() dto: { ids: string[]; assignedToId: string | null },
  ) {
    return this.svc.bulkAssign(dto.ids, dto.assignedToId);
  }
  @Get('staff/list') async staffList() {
    return this.svc.getStaff();
  }

  @Get('stream/updates')
  @Sse()
  streamUpdates(): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const interval = setInterval(() => {
      subject.next({
        data: JSON.stringify({
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
        }),
      } as MessageEvent);
    }, 10000);
    return new Observable((observer) => {
      subject.subscribe(observer);
      return () => clearInterval(interval);
    });
  }
}
