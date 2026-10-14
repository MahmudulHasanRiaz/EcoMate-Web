import { Controller, Get, Post, Put, Patch, Body, Param, Query } from '@nestjs/common';
import { CourierManagerService } from './courier-manager.service';
import { CourierTrackingService } from './courier-tracking.service';
import { CourierWebhookService } from './courier-webhook.service';
import { WebhookAttemptService } from './webhook-attempt.service';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'node:crypto';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { WebhookAttemptOutcome } from '@prisma/client';
import { CancelCarrybeeOrderDto } from './dto/cancel-carrybee-order.dto';

@Roles('superadmin', 'admin', 'employee')
@Controller('couriers')
@RequiresFeature('admin_courier')
export class CourierManagerController {
  constructor(
    private readonly svc: CourierManagerService,
    private readonly tracking: CourierTrackingService,
    private readonly prisma: PrismaService,
    private readonly webhookAttempts: WebhookAttemptService,
    private readonly webhooks: CourierWebhookService,
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
        shopId: dto['shopId'] as string,
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
        shopId: dto['shopId'] as string,
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

  /**
   * Task 5 (owner-locked): staff-triggered return reconciliation (no UI).
   * Reads GET /status_with_return_status_by_cid for one consignment and
   * applies the owner-approved return mapping (RETURNED/PARTIAL + return
   * state, stock reconcile on *_received, never COD-owed).
   */
  @Post('steadfast/reconcile-return')
  async reconcileSteadfastReturn(@Body() dto: { consignmentId?: string }) {
    return this.webhooks.reconcileSteadfastReturn({
      consignmentId: dto?.consignmentId ?? '',
    });
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
        payments: true,
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

  // Task 6: RedX update is PATCH /parcels per doc — the old PUT route is deleted.
  @Patch('redx/cancel/:trackingId')
  async cancelRedxParcel(
    @Param('trackingId') trackingId: string,
    @Body() dto: { reason: string },
  ) {
    return this.svc.cancelRedxParcel(trackingId, dto.reason);
  }

  // Task 7: Carrybee v2 details + cancel (doc: GET .../details,
  // POST .../cancel + cancellation_reason → 202).
  @Get('carrybee/details/:consignmentId')
  async getCarrybeeOrderDetails(@Param('consignmentId') consignmentId: string) {
    return this.svc.getCarrybeeOrderDetails(consignmentId);
  }

  @Post('carrybee/cancel/:consignmentId')
  async cancelCarrybeeOrder(
    @Param('consignmentId') consignmentId: string,
    @Body() dto: CancelCarrybeeOrderDto,
  ) {
    return this.svc.cancelCarrybeeOrder(consignmentId, dto?.reason);
  }

  @Get('order-tracking/:orderId')
  async getOrderTracking(@Param('orderId') orderId: string) {
    return this.tracking.getOrderTracking(orderId);
  }

  @Get('webhook-status')
  async getWebhookStatus() {
    // Task 4 settings banner: which couriers accept webhooks WITHOUT
    // signature verification (no token configured). RedX also honors the
    // per-env REDX_WEBHOOK_SECRET fallback.
    const creds = await this.prisma.courierCredentials.findMany({
      select: { courier: true, webhookSecret: true },
    });
    const hasSecret = new Map(
      creds.map((c) => [c.courier, !!c.webhookSecret?.trim()]),
    );
    const redxEnv = !!process.env['REDX_WEBHOOK_SECRET']?.trim();
    const status: Record<string, { configured: boolean }> = {};
    for (const courier of ['steadfast', 'pathao', 'redx', 'carrybee']) {
      status[courier] = {
        configured: courier === 'redx'
          ? (hasSecret.get('redx') || redxEnv)
          : !!hasSecret.get(courier),
      };
    }
    return status;
  }

  @Get('webhook-attempts')
  async listWebhookAttempts(
    @Query('courier') courier?: string,
    @Query('outcome') outcome?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedOutcome = outcome && outcome in WebhookAttemptOutcome
      ? outcome as WebhookAttemptOutcome
      : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 50) : 20;

    if (courier) {
      return this.webhookAttempts.getRecentAttempts(courier, {
        outcome: parsedOutcome,
        limit: parsedLimit,
      });
    }

    // Without courier filter, fetch across all couriers
    const couriers = ['steadfast', 'pathao', 'redx', 'carrybee'];
    const results = await Promise.all(
      couriers.map((c) =>
        this.webhookAttempts.getRecentAttempts(c, {
          outcome: parsedOutcome,
          limit: Math.ceil(parsedLimit / couriers.length),
        }),
      ),
    );
    return results
      .flat()
      .sort((a: any, b: any) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
      .slice(0, parsedLimit);
  }

  @Get('webhook-attempts/summary/:courier')
  async getWebhookAttemptSummary(@Param('courier') courier: string) {
    return this.webhookAttempts.getSummary(courier);
  }

  @Get('webhook-attempts/:id')
  async getWebhookAttemptDetail(@Param('id') id: string) {
    return this.webhookAttempts.getAttemptDetail(id);
  }
}
