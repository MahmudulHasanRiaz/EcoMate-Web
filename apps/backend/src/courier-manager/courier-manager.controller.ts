import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { CourierManagerService } from './courier-manager.service';
import { CourierTrackingService } from './courier-tracking.service';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'node:crypto';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('superadmin', 'admin', 'manager')
@Controller('couriers')
@RequiresFeature('admin_courier')
export class CourierManagerController {
  constructor(
    private readonly svc: CourierManagerService,
    private readonly tracking: CourierTrackingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('credentials')
  async listCredentials() {
    const existing = await this.prisma.courierCredentials.findMany({
      orderBy: { courier: 'asc' },
    });

    const defaults = ['steadfast', 'pathao', 'redx', 'carrybee'];
    const missing = defaults.filter(
      (d) => !existing.some((e) => e.courier === d),
    );

    if (missing.length > 0) {
      for (const courier of missing) {
        await this.prisma.courierCredentials.create({
          data: {
            courier,
            enabled: false,
            mode: 'sandbox',
            credentials: {},
          },
        });
      }
      return this.prisma.courierCredentials.findMany({
        orderBy: { courier: 'asc' },
      });
    }

    return existing;
  }

  @Get('default-note')
  async getDefaultNote() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'default_office_note' },
    });
    return { note: setting?.value || '' };
  }

  @Put('default-note')
  async setDefaultNote(@Body() dto: { note: string }) {
    await this.prisma.systemSetting.upsert({
      where: { key: 'default_office_note' },
      create: { key: 'default_office_note', value: dto.note || '' },
      update: { value: dto.note || '' },
    });
    return { note: dto.note || '' };
  }

  @Get('cities')
  async getCities() {
    return this.svc.getCities();
  }

  @Get('zones')
  async getZones(@Query('cityId') cityId: string) {
    return this.svc.getZones(cityId);
  }

  @Put('credentials/:courier')
  async upsertCredentials(
    @Param('courier') courier: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.prisma.courierCredentials.upsert({
      where: { courier },
      create: {
        courier,
        enabled: (dto['enabled'] as boolean) ?? false,
        mode: (dto['mode'] as string) || 'sandbox',
        apiKey: dto['apiKey'] as string,
        secretKey: dto['secretKey'] as string,
        username: dto['username'] as string,
        password: dto['password'] as string,
        clientId: dto['clientId'] as string,
        clientSecret: dto['clientSecret'] as string,
        clientContext: dto['clientContext'] as string,
        storeId: dto['storeId'] as string,
        webhookSecret: dto['webhookSecret'] as string,
        pathaoIntegrationSecret: dto['pathaoIntegrationSecret'] as string,
        credentials: dto['credentials'] || {},
      },
      update: {
        enabled: dto['enabled'] as boolean,
        mode: dto['mode'] as string,
        apiKey: dto['apiKey'] as string,
        secretKey: dto['secretKey'] as string,
        username: dto['username'] as string,
        password: dto['password'] as string,
        clientId: dto['clientId'] as string,
        clientSecret: dto['clientSecret'] as string,
        clientContext: dto['clientContext'] as string,
        storeId: dto['storeId'] as string,
        webhookSecret: dto['webhookSecret'] as string,
        pathaoIntegrationSecret: dto['pathaoIntegrationSecret'] as string,
        credentials: dto['credentials'] || {},
      },
    });
  }

  @Post('credentials/:courier/generate-webhook-secret')
  async generateWebhookSecret(@Param('courier') courier: string) {
    const secret = randomBytes(32).toString('hex');
    await this.prisma.courierCredentials.update({
      where: { courier },
      data: { webhookSecret: secret },
    });
    return { webhookSecret: secret };
  }

  @Post('dispatch/:courier')
  async dispatch(
    @Param('courier') courier: string,
    @Body() dto: { orderIds: string[] },
  ) {
    return this.svc.dispatch(courier, dto.orderIds);
  }

  @Get('dispatch-logs')
  async dispatchLogs(
    @Query('orderId') orderId?: string,
    @Query('courier') courier?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (orderId) where.orderId = orderId;
    if (courier) where.courier = courier;
    return this.prisma.courierDispatchLog.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Post('webhook/:courier')
  async webhook(@Param('courier') _courier: string, @Body() body: unknown) {
    const data = body as Record<string, unknown>;
    const orderId = (data['merchant_order_id'] ||
      data['invoice'] ||
      data['orderNumber'] ||
      data['order_id']) as string;
    const status = (data['status'] ||
      data['event'] ||
      data['delivery_status']) as string;

    if (orderId && status) {
      let order = await this.prisma.order.findFirst({
        where: { displayId: orderId },
      });
      if (!order)
        order = await this.prisma.order.findFirst({
          where: { courierConsignmentId: orderId },
        });

      if (order) {
        const statusMap: Record<string, string> = {
          pending: 'In Courier',
          picked: 'In Courier',
          delivered: 'Delivered',
          cancelled: 'Cancelled',
          returned: 'Returned',
          partial: 'Partial Return',
          hold: 'On Hold',
          in_transit: 'In Courier',
          failed: 'Cancelled',
        };
        const mapped = statusMap[status?.toLowerCase()] || status;

        await this.prisma.order.update({
          where: { id: order.id },
          data: { courierStatus: mapped },
        });
      }
    }

    return { received: true };
  }

  @Get('steadfast/balance')
  async getSteadfastBalance() {
    return this.svc.getSteadfastBalance();
  }

  @Post('steadfast/return')
  async createSteadfastReturn(
    @Body()
    dto: {
      consignment_id?: string;
      invoice?: string;
      tracking_code?: string;
      reason?: string;
    },
  ) {
    return this.svc.createSteadfastReturnRequest(dto);
  }

  @Get('steadfast/return/:id')
  async getSteadfastReturn(@Param('id') id: string) {
    return this.svc.getSteadfastReturnRequest(id);
  }

  @Get('steadfast/returns')
  async getSteadfastReturns() {
    return this.svc.getSteadfastReturnRequests();
  }

  @Get('steadfast/payments')
  async getSteadfastPayments() {
    return this.svc.getSteadfastPayments();
  }

  @Get('steadfast/payment/:id')
  async getSteadfastPayment(@Param('id') id: string) {
    return this.svc.getSteadfastPaymentWithConsignments(id);
  }

  @Get('steadfast/police-stations')
  async getSteadfastPoliceStations() {
    return this.svc.getSteadfastPoliceStations();
  }

  @Post('steadfast/bulk')
  async bulkCreateSteadfastOrders(@Body() dto: { orderIds: string[] }) {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: dto.orderIds } },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        items: { include: { product: { select: { name: true } } } },
      },
    });
    return this.svc.bulkCreateSteadfastOrders(orders);
  }

  @Get('redx/parcel/:trackingId')
  async getRedxParcelDetails(@Param('trackingId') trackingId: string) {
    return this.svc.getRedxParcelDetails(trackingId);
  }

  @Get('redx/track/:trackingId')
  async trackRedxParcel(@Param('trackingId') trackingId: string) {
    return this.svc.trackRedxParcel(trackingId);
  }

  @Put('redx/cancel/:trackingId')
  async cancelRedxParcel(
    @Param('trackingId') trackingId: string,
    @Body() dto: { reason: string },
  ) {
    return this.svc.cancelRedxParcel(trackingId, dto.reason);
  }

  @Get('order-tracking/:orderId')
  async getOrderTracking(@Param('orderId') orderId: string) {
    return this.tracking.getOrderTracking(orderId);
  }
}
