import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Optional, NotFoundException } from '@nestjs/common';
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
import { UpdateCourierEnabledDto } from './dto/update-courier-enabled.dto';
import type { SteadfastCredentialSetsService } from './steadfast-credential-sets.service';

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
    @Optional() private readonly sets?: SteadfastCredentialSetsService,
  ) {}

  private requireSets(): SteadfastCredentialSetsService {
    if (!this.sets) throw new Error('Credential sets not available');
    return this.sets;
  }

  // SECURITY (2026-10-25): this list endpoint NEVER returns credential
  // values — an employee with courier-settings access used to read every
  // courier API key/secret in one GET. Callers get fieldsPresent (which
  // secret fields are set) and must send new values to change them; the
  // PUT below treats an empty/missing secret field as "keep existing".
  // Owner-requested exception (2026-10-31): the per-courier reveal
  // endpoint further down returns ONE courier's values on an explicit
  // eye-toggle click — the bulk list stays masked.
  private static readonly SECRET_FIELDS = [
    'apiKey',
    'secretKey',
    'username',
    'password',
    'clientId',
    'clientSecret',
    'clientContext',
    'storeId',
    'shopId',
    'webhookSecret',
    'pathaoIntegrationSecret',
  ];

  private maskCredentials(row: any) {
    const SECRET_FIELDS = CourierManagerController.SECRET_FIELDS;
    const credsJson =
      row.credentials && typeof row.credentials === 'object'
        ? row.credentials
        : {};
    const fieldsPresent = SECRET_FIELDS.filter(
      (f) =>
        (typeof row[f] === 'string' && row[f].trim() !== '') ||
        (typeof credsJson[f] === 'string' && credsJson[f].trim() !== ''),
    );
    return {
      id: row.id,
      courier: row.courier,
      enabled: row.enabled,
      mode: row.mode,
      fieldsPresent,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

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
      const rows = await this.prisma.courierCredentials.findMany({
        orderBy: { courier: 'asc' },
      });
      return rows.map((r) => this.maskCredentials(r));
    }

    return existing.map((r) => this.maskCredentials(r));
  }

  /**
   * Reveal ONE courier's stored credential values (owner request
   * 2026-10-31: eye toggle on the settings page; revealed text is
   * selectable for manual copy — no bulk exposure). Same class-level
   * @Roles gate as credential writes. Values merge the columns with the
   * legacy credentials JSON, exactly as dispatch reads them.
   */
  @Get('credentials/:courier/reveal')
  async revealCredentials(@Param('courier') courier: string) {
    const row = await this.prisma.courierCredentials.findUnique({
      where: { courier },
    });
    if (!row) {
      throw new NotFoundException(`Courier ${courier} is not configured`);
    }
    const credsJson =
      row.credentials && typeof row.credentials === 'object'
        ? (row.credentials as Record<string, unknown>)
        : {};
    const values: Record<string, string> = {};
    for (const f of CourierManagerController.SECRET_FIELDS) {
      const col = (row as any)[f];
      const legacy = credsJson[f];
      values[f] =
        typeof col === 'string' && col !== ''
          ? col
          : typeof legacy === 'string'
            ? legacy
            : '';
    }
    return { courier, values };
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
    // Empty = keep (2026-10-25): since GET no longer returns values, the
    // admin form sends blank for unchanged secrets. A blank must never
    // wipe a stored secret — only a non-empty value overwrites it. (There
    // is deliberately no way to clear a single secret through this route;
    // use a direct DB edit for that rare case.)
    const existing = await this.prisma.courierCredentials.findUnique({
      where: { courier },
    });
    const secret = (field: string): string | undefined => {
      const v = dto[field];
      if (typeof v === 'string' && v.trim() !== '') return v;
      return (existing as any)?.[field] ?? undefined;
    };
    const credsDto = dto['credentials'];
    const credsValue =
      credsDto &&
      typeof credsDto === 'object' &&
      Object.keys(credsDto as object).length > 0
        ? credsDto
        : ((existing as any)?.credentials ?? {});
    const data = {
      enabled:
        typeof dto['enabled'] === 'boolean'
          ? dto['enabled']
          : (existing?.enabled ?? false),
      mode: (dto['mode'] as string) || existing?.mode || 'sandbox',
      apiKey: secret('apiKey'),
      secretKey: secret('secretKey'),
      username: secret('username'),
      password: secret('password'),
      clientId: secret('clientId'),
      clientSecret: secret('clientSecret'),
      clientContext: secret('clientContext'),
      storeId: secret('storeId'),
      shopId: secret('shopId'),
      webhookSecret: secret('webhookSecret'),
      pathaoIntegrationSecret: secret('pathaoIntegrationSecret'),
      credentials: credsValue,
    };
    const saved = await this.prisma.courierCredentials.upsert({
      where: { courier },
      create: { courier, ...data },
      update: data,
    });
    return this.maskCredentials(saved);
  }

  /**
   * Settings-card enable switch persists on its own (queue burn-down D1).
   *
   * The full upsert above rewrites every credential column from the request
   * body and resets the legacy `credentials` JSON to `{}` when it is omitted.
   * Using it for a bare toggle would either commit half-typed secrets or
   * erase legacy credential fallbacks, so this route writes ONLY `enabled`.
   * The response is deliberately narrow — no secrets are echoed back.
   */
  @Patch('credentials/:courier/enabled')
  async setCourierEnabled(
    @Param('courier') courier: string,
    @Body() dto: UpdateCourierEnabledDto,
  ): Promise<{ courier: string; enabled: boolean }> {
    // Missing row (P2025) is mapped to 404 by GlobalExceptionFilter.
    return this.prisma.courierCredentials.update({
      where: { courier },
      data: { enabled: dto.enabled },
      select: { courier: true, enabled: true },
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
    @Body() dto: { orderIds: string[]; credentialSetId?: string },
  ) {
    // Task 8: steadfast order-level override (picker shows iff >1 set).
    return this.svc.dispatch(courier, dto.orderIds, {
      credentialSetId: dto.credentialSetId ?? null,
    });
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

  // ── Task 8: Steadfast hybrid credential sets (labels only — keys NEVER
  // shown; list meta carries hasApiKey/hasSecret/hasWebhook flags only). ──
  // Hardening (5a): an unwired sets provider degrades to [] (settings UI
  // renders "no accounts"), never an unhandled 500.
  @Get('credential-sets')
  async listCredentialSets() {
    if (!this.sets) return [];
    return this.requireSets().listSets();
  }

  @Post('credential-sets')
  async createCredentialSet(
    @Body()
    dto: {
      label: string;
      apiKey: string;
      secretKey: string;
      webhookSecret?: string;
      isDefault?: boolean;
    },
  ) {
    return this.requireSets().createSet(dto);
  }

  @Put('credential-sets/:id')
  async updateCredentialSet(
    @Param('id') id: string,
    @Body()
    dto: { label?: string; apiKey?: string | null; secretKey?: string | null; webhookSecret?: string | null },
  ) {
    return this.requireSets().updateSet(id, dto);
  }

  @Delete('credential-sets/:id')
  async deleteCredentialSet(@Param('id') id: string) {
    return this.requireSets().deleteSet(id);
  }

  @Post('credential-sets/:id/make-default')
  async makeCredentialSetDefault(@Param('id') id: string) {
    return this.requireSets().setDefault(id);
  }

  /** Reveal one Steadfast set's decrypted keys (eye toggle, 2026-10-31). */
  @Get('credential-sets/:id/reveal')
  async revealCredentialSet(@Param('id') id: string) {
    return this.requireSets().revealSet(id);
  }

  @Get('steadfast/balance')
  async getSteadfastBalance(@Query('setId') setId?: string) {
    return this.svc.getSteadfastBalance({ credentialSetId: setId ?? null });
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
      credentialSetId?: string;
    },
  ) {
    return this.svc.createSteadfastReturnRequest(dto);
  }

  @Get('steadfast/return/:id')
  async getSteadfastReturn(@Param('id') id: string, @Query('setId') setId?: string) {
    return this.svc.getSteadfastReturnRequest(id, { credentialSetId: setId ?? null });
  }

  @Get('steadfast/returns')
  async getSteadfastReturns(
    @Query('setId') setId?: string,
    @Query('page') page?: string,
    @Query('all') all?: string,
  ) {
    return this.svc.getSteadfastReturnRequests({
      credentialSetId: setId ?? null,
      page: page ? parseInt(page, 10) : undefined,
      all: all === 'false' ? false : undefined,
    });
  }

  @Get('steadfast/payments')
  async getSteadfastPayments(
    @Query('setId') setId?: string,
    @Query('page') page?: string,
    @Query('all') all?: string,
  ) {
    return this.svc.getSteadfastPayments({
      credentialSetId: setId ?? null,
      page: page ? parseInt(page, 10) : undefined,
      all: all === 'false' ? false : undefined,
    });
  }

  @Get('steadfast/payment/:id')
  async getSteadfastPayment(@Param('id') id: string, @Query('setId') setId?: string) {
    return this.svc.getSteadfastPaymentWithConsignments(id, { credentialSetId: setId ?? null });
  }

  @Get('steadfast/police-stations')
  async getSteadfastPoliceStations(@Query('setId') setId?: string) {
    return this.svc.getSteadfastPoliceStations({ credentialSetId: setId ?? null });
  }

  @Post('steadfast/bulk')
  async bulkCreateSteadfastOrders(
    @Body() dto: { orderIds: string[]; credentialSetId?: string },
  ) {
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
    return this.svc.bulkCreateSteadfastOrders(orders, {
      credentialSetId: dto.credentialSetId ?? null,
    });
  }

  @Get('redx/parcel/:trackingId')
  async getRedxParcelDetails(@Param('trackingId') trackingId: string) {
    return this.svc.getRedxParcelDetails(trackingId);
  }

  /**
   * Task 9(c): RedX dispatch-time charge preview (non-blocking info).
   * GET /couriers/redx/charge?delivery_area_id=&cash_collection_amount=&
   * weight=[&pickup_area_id=] → {deliveryCharge, codCharge}.
   */
  @Get('redx/charge')
  async getRedxCharge(
    @Query('delivery_area_id') deliveryAreaId?: string,
    @Query('pickup_area_id') pickupAreaId?: string,
    @Query('cash_collection_amount') cashCollectionAmount?: string,
    @Query('weight') weight?: string,
  ) {
    return this.svc.getRedxCharge({
      delivery_area_id: deliveryAreaId as any,
      pickup_area_id: pickupAreaId as any,
      cash_collection_amount: cashCollectionAmount as any,
      weight: weight as any,
    });
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

  /**
   * Task 9(a): Pathao bulk create — POST /couriers/pathao/bulk {orderIds}.
   * 202 = accepted/async (NOT created). Each entry reports
   * "accepted, processing"; verify later via GET /couriers/pathao/info/:id.
   */
  @Post('pathao/bulk')
  async bulkCreatePathaoOrders(@Body() dto: { orderIds: string[] }) {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: dto.orderIds } },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            // weightGram rides along for the Q12 dispatch weight rule.
            product: { select: { name: true, weightGram: true } },
          },
        },
        payments: true,
      },
    });
    return (this.svc as any).bulkCreatePathaoOrders(orders);
  }

  @Get('pathao/info/:consignmentId')
  async getPathaoOrderInfo(@Param('consignmentId') consignmentId: string) {
    return (this.svc as any).getPathaoOrderInfo(consignmentId);
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
    // Task 8: steadfast counts as configured when the legacy secret OR any
    // credential set carries a webhook token.
    let steadfastSetsConfigured = false;
    if (this.sets) {
      const sets = await this.sets.listSets().catch(() => []);
      steadfastSetsConfigured = sets.some((s: any) => s.hasWebhook);
    }
    const status: Record<string, { configured: boolean }> = {};
    for (const courier of ['steadfast', 'pathao', 'redx', 'carrybee']) {
      status[courier] = {
        configured: courier === 'redx'
          ? (hasSecret.get('redx') || redxEnv)
          : courier === 'steadfast'
            ? (!!hasSecret.get('steadfast') || steadfastSetsConfigured)
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
