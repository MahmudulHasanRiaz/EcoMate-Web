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
  Req,
} from '@nestjs/common';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';

import { OrdersService } from './orders.service';
import { OrdersEventService } from './orders-event.service';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
  CancelOrderDto,
} from './dto/order.dto';
import {
  BulkOrdersDto,
  BulkStatusDto,
  BulkDispatchDto,
  BulkAssignDto,
} from './dto/bulk-order.dto';
import { SubmitPaymentProofDto } from './dto/public-order-tracking.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Observable } from 'rxjs';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly svc: OrdersService,
    private readonly events: OrdersEventService,
  ) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('statusId') statusId?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('courier') courier?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('includeTrashed') includeTrashed?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      search,
      statusId,
      paymentStatus,
      courier,
      assignedToId,
      dateFrom,
      dateTo,
      sort,
      order,
      includeTrashed: includeTrashed === 'true',
    });
  }

  @Get('my')
  findMyOrders(
    @CurrentUser() user: { userId: string },
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.findMyOrders(user.userId, {
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      status,
    });
  }

  @Get('my/:id')
  findMyOrderById(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.svc.findMyOrderById(user.userId, id);
  }

  @Public()
  @RateLimitPolicy('api')
  @Post()
  create(@Body() dto: CreateOrderDto, @Req() req: any, @CurrentUser() user?: { userId: string }) {
    return this.svc.create(dto, req?.ip || req?.socket?.remoteAddress || '', user?.userId);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_orders')
  @Post('backfill-view-tokens')
  backfillViewTokens() {
    return this.svc.backfillViewTokens();
  }

  @Public()
  @RateLimitPolicy('api')
  @Get('public/phone/:phone')
  findByPhone(@Param('phone') phone: string) {
    return this.svc.findByPhone(phone);
  }

  /**
   * Display-id (order-number) lookup. Strictly no-PII.
   * Never accepts or searches by viewToken.
   */
  @Public()
  @RateLimitPolicy('api')
  @Get('public/display/:displayId')
  findByDisplayId(@Param('displayId') displayId: string) {
    return this.svc.findByDisplayId(displayId);
  }

  /**
   * Guest tracking lookup by secret viewToken.
   * Returns a richer but still-allowlisted guest DTO.
   * Never treats the input as a displayId.
   */
  @Public()
  @RateLimitPolicy('api')
  @Get('public/token/:viewToken')
  findByViewToken(@Param('viewToken') viewToken: string) {
    return this.svc.findByViewToken(viewToken);
  }

  /**
   * Legacy public reference route — treats the input as a displayId only.
   * Never guesses or treats it as a viewToken.
   */
  @Public()
  @RateLimitPolicy('api')
  @Get('public/:reference')
  findByReference(@Param('reference') reference: string) {
    return this.svc.findByDisplayId(reference);
  }

  @Public()
  @RateLimitPolicy('checkout')
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string } | null | undefined,
    @Query('t') token?: string,
  ) {
    return this.svc.findOne(id, { token, userId: user?.userId });
  }

  /** Public, but requires valid viewToken (for guests) OR authenticated ownership (for logged-in customers). */
  @Public()
  @RateLimitPolicy('checkout')
  @Post(':id/submit-payment-proof')
  async submitPaymentProof(
    @Param('id') id: string,
    @Body() proofData: SubmitPaymentProofDto,
    @CurrentUser() user: { userId: string } | null | undefined,
  ) {
    return this.svc.submitPaymentProof(id, proofData, {
      userId: user?.userId,
      token: proofData.token,
    });
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post(':id/verify-payment')
  async verifyPayment(
    @Param('id') id: string,
    @Body('verified') verified: boolean,
    @Body('note') note?: string,
  ) {
    return this.svc.verifyPayment(id, verified, note);
  }

  @Public()
  @Post(':id/cancel')
  cancelByCustomer(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.svc.cancelByCustomer(id, dto.token);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post(':id/rotate-view-token')
  rotateViewToken(@Param('id') id: string) {
    return this.svc.rotateViewToken(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Put(':id')
  updateOrder(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.svc.updateOrder(id, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Put(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    return this.svc.updateStatus(id, dto, user.userId, user.email);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: UpdateOrderItemDto) {
    return this.svc.addItem(id, dto);
  }
  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Delete(':id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.svc.removeItem(id, itemId);
  }
  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post(':id/note')
  addNote(
    @Param('id') id: string,
    @Body() dto: { note: string; visibility: 'public' | 'private' },
    @CurrentUser() user: { userId: string; email: string },
  ) {
    return this.svc.addNote(
      id,
      dto.note,
      dto.visibility,
      user.userId,
      user.email,
    );
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post('bulk')
  async bulkOrders(@Body() dto: BulkOrdersDto) {
    const orders = await this.svc.bulkOrders(dto.ids || []);
    return { orders };
  }
  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post('bulk/status')
  async bulkStatus(@Body() dto: BulkStatusDto, @CurrentUser() user: any) {
    return this.svc.bulkStatusChange(
      dto.ids,
      dto.statusId,
      user?.userId || 'system',
    );
  }
  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post('bulk/dispatch')
  async bulkDispatch(
    @Body() dto: BulkDispatchDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.bulkDispatch(dto.courier, dto.ids, user.userId);
  }
  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post('bulk/assign')
  async bulkAssign(@Body() dto: BulkAssignDto) {
    return this.svc.bulkAssign(dto.ids, dto.assignedToId);
  }
  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post(':id/trash')
  trashOrder(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    return this.svc.trash(id, user.email || user.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Post(':id/restore')
  restoreOrder(@Param('id') id: string) {
    return this.svc.restore(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_orders')
  @Get('staff/list')
  async staffList() {
    return this.svc.getStaff();
  }

  @RateLimitPolicy('api')
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
