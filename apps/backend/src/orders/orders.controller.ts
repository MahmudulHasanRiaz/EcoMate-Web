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
import { OrdersEventService } from './orders-event.service';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
  CancelOrderDto,
} from './dto/order.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Observable } from 'rxjs';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly svc: OrdersService,
    private readonly events: OrdersEventService,
  ) {}

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

  @Public()
  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin')
  @Post('backfill-view-tokens')
  backfillViewTokens() {
    return this.svc.backfillViewTokens();
  }

  @Public()
  @Get('public/:viewToken')
  findByViewToken(@Param('viewToken') viewToken: string) {
    return this.svc.findByViewToken(viewToken);
  }

  @Public()
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string } | null | undefined,
    @Query('t') token?: string,
  ) {
    return this.svc.findOne(id, { token, userId: user?.userId });
  }

  @Public()
  @Post(':id/cancel')
  cancelByCustomer(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.svc.cancelByCustomer(id, dto.token);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post(':id/rotate-view-token')
  rotateViewToken(@Param('id') id: string) {
    return this.svc.rotateViewToken(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Put(':id')
  updateOrder(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.svc.updateOrder(id, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Put(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    return this.svc.updateStatus(id, dto, user.userId, user.email);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: UpdateOrderItemDto) {
    return this.svc.addItem(id, dto);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Delete(':id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.svc.removeItem(id, itemId);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post(':id/note')
  addNote(
    @Param('id') id: string,
    @Body() dto: { note: string; visibility: 'public' | 'private' },
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.addNote(id, dto.note, dto.visibility, user.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk')
  async bulkOrders(@Body() dto: { ids: string[] }) {
    const orders = await this.svc.bulkOrders(dto.ids || []);
    return { orders };
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk/status')
  async bulkStatus(@Body() dto: { ids: string[]; statusId: string }) {
    return this.svc.bulkStatusChange(dto.ids, dto.statusId);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk/dispatch')
  async bulkDispatch(
    @Body() dto: { ids: string[]; courier: string },
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.bulkDispatch(dto.courier, dto.ids, user.userId);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk/assign')
  async bulkAssign(
    @Body() dto: { ids: string[]; assignedToId: string | null },
  ) {
    return this.svc.bulkAssign(dto.ids, dto.assignedToId);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Get('staff/list')
  async staffList() {
    return this.svc.getStaff();
  }

  @Get('stream/updates')
  @Sse()
  streamUpdates(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      const heartbeat = setInterval(() => {
        observer.next({
          data: JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          }),
        } as MessageEvent);
      }, 10000);

      const sub = this.events.subscribe().subscribe((event) => {
        observer.next({ data: JSON.stringify(event) } as MessageEvent);
      });

      return () => {
        clearInterval(heartbeat);
        sub.unsubscribe();
      };
    });
  }
}
