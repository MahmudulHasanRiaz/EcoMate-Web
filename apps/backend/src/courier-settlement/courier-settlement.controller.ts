// ── Courier Settlement controller (PRD §5–§14).
// Repo convention: @Controller('courier-settlement') (global 'api' prefix) +
// class @RequiresFeature('admin_courier_settlement') + @Roles(...). Handlers
// re-declare their FULL permission requirement because handler metadata
// REPLACES class metadata in PermissionsGuard (getAllAndOverride gotcha).

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import * as fastify from 'fastify';
import { Prisma } from '@prisma/client';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import { CourierSettlementImportService } from './courier-settlement-import.service';
import { CourierSettlementFinalizeService } from './courier-settlement-finalize.service';
import { CourierSettlementOverviewService } from './overview.service';
import { CourierSettlementExceptionsService } from './exceptions.service';
import { CourierSettlementAdjustmentsService } from './adjustments.service';
import { CourierSettlementSnapshotService } from './snapshot.service';
import { CourierSettlementReconciliationService } from './reconciliation.service';
import { CourierSettlementCostService } from './cost-projection.service';
import { CourierSettlementMappingService } from './column-mapping.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  AcknowledgeDto,
  DiscardInvoiceDto,
  MappingDto,
  MappingActionDto,
  AdjustmentDto,
  BalanceQueryDto,
  CorrectionPreviewDto,
  FinanceRuleDto,
  FinanceRuleTestDto,
  InvoiceListQueryDto,
  ManualMatchDto,
  ReverseAdjustmentDto,
} from './dto/courier-settlement.dto';
import { MAX_UPLOAD_BYTES } from './courier-settlement.constants';

interface User {
  userId: string;
}

@Controller('courier-settlement')
@RequiresFeature('admin_courier_settlement')
@Roles('superadmin', 'admin', 'employee')
export class CourierSettlementController {
  constructor(
    private readonly importer: CourierSettlementImportService,
    private readonly finalize: CourierSettlementFinalizeService,
    private readonly overview: CourierSettlementOverviewService,
    private readonly exceptions: CourierSettlementExceptionsService,
    private readonly adjustments: CourierSettlementAdjustmentsService,
    private readonly snapshots: CourierSettlementSnapshotService,
    private readonly reconciliation: CourierSettlementReconciliationService,
    private readonly cost: CourierSettlementCostService,
    private readonly mappings: CourierSettlementMappingService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ── Read models ──

  @Get('overview')
  @Permissions('view_courier_settlement')
  getOverview(@Query() query: InvoiceListQueryDto) {
    return this.overview.getOverview(query);
  }

  @Get('invoices')
  @Permissions('view_courier_settlement')
  listInvoices(@Query() query: InvoiceListQueryDto) {
    return this.overview.listInvoices(query);
  }

  @Get('balances')
  @Permissions('view_courier_settlement')
  balances(@Query() query: BalanceQueryDto) {
    return this.overview.getBalances(query);
  }

  @Get('exceptions')
  @Permissions('view_courier_settlement')
  async listExceptions(
    @Query('invoiceId') invoiceId?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('limit') limit?: string,
  ) {
    // No invoiceId ⇒ cross-invoice work queue (matches the overview KPI).
    const take = Number(limit) > 0 ? Number(limit) : 500;
    return this.exceptions.list(invoiceId || undefined, status || undefined, take, severity || undefined);
  }

  @Get('invoices/:id')
  @Permissions('view_courier_settlement')
  async getInvoice(
    @Param('id') id: string,
    @Query('rowsPage') rowsPage?: string,
    @Query('rowsLimit') rowsLimit?: string,
    @Query('exceptionsLimit') exceptionsLimit?: string,
  ) {
    // §20 P13: never ship an unbounded document — rows/exceptions are paged
    // (default 250 rows / 200 exceptions per response).
    const page = Math.max(1, Number(rowsPage) || 1);
    const limit = Math.min(500, Math.max(1, Number(rowsLimit) || 250));
    const exceptionLimit = Math.min(1000, Math.max(1, Number(exceptionsLimit) || 200));
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id },
      include: {
        rows: {
          orderBy: { rowNumber: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        },
        exceptions: { orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }], take: exceptionLimit },
        _count: { select: { rows: true, exceptions: true } },
      },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');
    const rowsMeta = {
      page,
      limit,
      total: invoice._count.rows,
      pages: Math.ceil(invoice._count.rows / limit),
    };
    const exceptionsMeta = { limit: exceptionLimit, total: invoice._count.exceptions };
    let historical: unknown = null;
    try {
      historical = await this.snapshots.getHistorical(id);
    } catch {
      historical = null;
    }
    const effective = await this.snapshots.getEffective(id);
    const { _count, ...rest } = invoice;
    return {
      invoice: rest,
      rowsMeta,
      exceptionsMeta,
      historical,
      effective,
      divergence: this.divergence(historical, effective),
    };
  }

  /**
   * §14.3 — `null` while the finalization snapshot still equals the current
   * effective state; otherwise the per-field before/after the UI renders as
   * "Historical at finalization" vs "Current effective".
   */
  private divergence(historical: unknown, effective: { effectiveTotals: unknown }): unknown {
    if (!historical) return null;
    const h = historical as {
      version?: number;
      takenAt?: unknown;
      totals?: Record<string, unknown>;
    };
    if (!h.totals) return null;
    const current = (effective.effectiveTotals ?? {}) as Record<string, unknown>;
    const fields: Record<string, { from: number; to: number }> = {};
    for (const key of ['collected', 'charges', 'net', 'residual', 'cashReceived', 'cashDisbursed']) {
      const from = Number(h.totals[key] ?? 0);
      const to = Number(current[key] ?? 0);
      if (Math.abs(from - to) > 0.005) fields[key] = { from, to };
    }
    if (Object.keys(fields).length === 0) return null;
    return { version: h.version, takenAt: h.takenAt, fields };
  }

  /**
   * Original uploaded bytes (§9 ①): immutable source document, served inline
   * for the viewer. Never the effective/derived view — the Sheet tab stays raw.
   */
  @Get('invoices/:id/source')
  @Permissions('view_courier_settlement')
  async sourceFile(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: fastify.FastifyReply,
  ) {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id },
      select: { fileStorageId: true, fileOriginalName: true, fileMime: true },
    });
    if (!invoice?.fileStorageId) {
      throw new BadRequestException('The original file was not stored for this invoice');
    }
    const buffer = await this.storage.readMediaOriginal(
      invoice.fileOriginalName ?? 'invoice',
      invoice.fileStorageId,
    );
    const filename = (invoice.fileOriginalName ?? 'invoice').replace(/["\\]/g, '');
    res.header('Content-Type', invoice.fileMime ?? 'application/octet-stream');
    res.header('Content-Length', String(buffer.length));
    res.header('Content-Disposition', `inline; filename="${filename}"`);
    res.header('X-Content-Type-Options', 'nosniff');
    return buffer;
  }

  @Get('invoices/:id/historical')
  @Permissions('view_courier_settlement')
  historical(@Param('id') id: string) {
    return this.snapshots.getHistorical(id);
  }

  @Get('invoices/:id/effective')
  @Permissions('view_courier_settlement')
  effective(@Param('id') id: string) {
    return this.snapshots.getEffective(id);
  }

  @Get('invoices/:id/activity')
  @Permissions('view_courier_settlement')
  activity(@Param('id') id: string) {
    return this.prisma.courierSettlementActivity.findMany({
      where: { invoiceId: id },
      orderBy: { timestamp: 'asc' },
    });
  }

  @Get('invoices/:id/adjustments')
  @Permissions('view_courier_settlement')
  adjustmentsList(@Param('id') id: string) {
    return this.adjustments.list(id);
  }

  @Get('rows/:rowId')
  @Permissions('view_courier_settlement')
  async getRow(@Param('rowId') rowId: string) {
    const row = await this.prisma.courierSettlementRow.findUnique({
      where: { id: rowId },
      include: { exceptions: true, adjustments: true },
    });
    if (!row) throw new BadRequestException('Row not found');
    return row;
  }

  // ── Ingestion ──

  /**
   * Step 1 of the import workflow — ANALYZE, never commit. Parses the file,
   * stores the immutable bytes and returns the full preview; the invoice is
   * left as a draft (ANALYZED / MAPPING_REQUIRED) with zero rows, zero
   * exceptions and zero KPI effect. Nothing is financially accepted until
   * `POST /invoices/:id/import` is called from the preview decision point.
   */
  @Post('invoices/upload')
  @RateLimitPolicy('api')
  @Permissions('view_courier_settlement', 'import_courier_settlement')
  async uploadInvoice(
    @Req() req: fastify.FastifyRequest,
    @CurrentUser() user: User | null,
  ) {
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!file) throw new BadRequestException('No file uploaded');
    const fields = (file.fields ?? {}) as Record<string, { value?: unknown }>;
    const pick = (k: string) => (fields[k]?.value != null ? String(fields[k].value) : undefined);
    const buffer = await file.toBuffer();
    return this.importer.analyze({
      buffer,
      filename: file.filename,
      mimeType: file.mimetype,
      courier: pick('courier'),
      revisionOfId: pick('revisionOfId'),
      reason: pick('reason'),
      actor: user?.userId ?? null,
    });
  }

  /** Step 2 — re-open a stored draft's preview without re-uploading. */
  @Get('invoices/:id/preview')
  @Permissions('view_courier_settlement', 'import_courier_settlement')
  previewDraft(@Param('id') id: string) {
    return this.importer.previewFor(id);
  }

  /**
   * Step 3 — the single confirmation point. Draft → rows + exceptions. Refuses
   * anything that is not a draft (409), so an import can never be replayed.
   * Large invoices (≥ threshold) return `{ state: 'IMPORTING' }` immediately and
   * finish in the background with progress the admin can poll (§17).
   */
  @Post('invoices/:id/import')
  @RateLimitPolicy('api')
  @Permissions('view_courier_settlement', 'import_courier_settlement')
  commitImport(@Param('id') id: string, @CurrentUser() user: User | null) {
    return this.importer.commitOrSchedule(id, user?.userId ?? null);
  }

  // ── Column mapping (§12) ──

  @Get('mappings')
  @Permissions('view_courier_settlement')
  listMappings(@Query('courier') courier?: string) {
    return this.mappings.list(courier || undefined);
  }

  @Post('mappings')
  @Permissions('view_courier_settlement', 'import_courier_settlement')
  proposeMapping(@Body() dto: MappingDto, @CurrentUser() user: User | null) {
    return this.mappings.propose(dto, user?.userId ?? null);
  }

  @Post('mappings/:id/activate')
  @Permissions('view_courier_settlement', 'import_courier_settlement')
  activateMapping(
    @Param('id') id: string,
    @Body() dto: MappingActionDto,
    @CurrentUser() user: User | null,
  ) {
    return this.mappings.activate(id, dto, user?.userId ?? null);
  }

  @Post('mappings/:id/deactivate')
  @Permissions('view_courier_settlement', 'import_courier_settlement')
  deactivateMapping(
    @Param('id') id: string,
    @Body() dto: MappingActionDto,
    @CurrentUser() user: User | null,
  ) {
    return this.mappings.deactivate(id, dto, user?.userId ?? null);
  }

  /**
   * Workspace Reconciliation queue: one row per invoice that still carries
   * review work, with its red/yellow split, so an operator can drill from
   * "what needs attention" straight into the invoice's Reconciliation tab.
   */
  @Get('reconciliation')
  @Permissions('view_courier_settlement')
  async reconciliationQueue(@Query() query: InvoiceListQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const where: Prisma.CourierSettlementInvoiceWhereInput = {
      state: { notIn: ['DISCARDED', 'UPLOADED', 'ANALYZED'] },
    };
    if (query.courier) where.courier = query.courier;
    const [total, invoices] = await Promise.all([
      this.prisma.courierSettlementInvoice.count({ where }),
      this.prisma.courierSettlementInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          displayId: true,
          courier: true,
          provider: true,
          state: true,
          rowCount: true,
          createdAt: true,
          finalizedAt: true,
          exceptions: {
            where: { status: { in: ['open', 'acknowledged'] } },
            select: { severity: true, status: true, ruleId: true, blocked: true },
          },
          _count: { select: { rows: true } },
        },
      }),
    ]);
    const matchedGroups = invoices.length
      ? await this.prisma.courierSettlementRow.groupBy({
          by: ['invoiceId'],
          where: {
            invoiceId: { in: invoices.map((i) => i.id) },
            matchMethod: { not: 'NONE' },
          },
          _count: { _all: true },
        })
      : [];
    const matchedById = new Map(
      matchedGroups.map((g) => [g.invoiceId, g._count._all]),
    );
    const items = invoices.map((i) => {
      const red = i.exceptions.filter((e) => e.severity === 'red' && e.status === 'open').length;
      const yellowOpen = i.exceptions.filter((e) => e.severity === 'yellow' && e.status === 'open').length;
      const yellowAck = i.exceptions.filter((e) => e.severity === 'yellow' && e.status === 'acknowledged').length;
      return {
        invoiceId: i.id,
        displayId: i.displayId,
        courier: i.courier,
        provider: i.provider,
        state: i.state,
        rows: i._count.rows,
        createdAt: i.createdAt,
        finalizedAt: i.finalizedAt,
        red,
        yellow: yellowOpen,
        acknowledged: yellowAck,
        needsAttention: red + yellowOpen,
        matched: matchedById.get(i.id) ?? 0,
      };
    });
    return {
      data: items,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  @Post('invoices/:id/finalize')
  @Permissions('view_courier_settlement', 'finalize_courier_settlement')
  finalizeInvoice(@Param('id') id: string, @CurrentUser() user: User | null) {
    return this.finalize.finalize(id, user?.userId ?? null);
  }

  @Post('invoices/:id/discard')
  @Permissions('view_courier_settlement', 'adjust_courier_settlement')
  discardInvoice(
    @Param('id') id: string,
    @Body() dto: DiscardInvoiceDto,
    @CurrentUser() user: User | null,
  ) {
    return this.finalize.discard(id, user?.userId ?? null, dto.reason);
  }

  @Post('invoices/:id/repair-accounting')
  @Permissions('view_courier_settlement', 'finalize_courier_settlement')
  repairAccounting(@Param('id') id: string, @CurrentUser() user: User | null) {
    return this.finalize.repairAccounting(id, user?.userId ?? null);
  }

  @Post('invoices/:id/reclaim-stale')
  @Permissions('view_courier_settlement', 'finalize_courier_settlement')
  async reclaimStale(@Param('id') id: string, @CurrentUser() user: User | null) {
    const reclaimed = await this.finalize.reclaimStale(id, user?.userId ?? null);
    return { reclaimed };
  }

  @Post('invoices/:id/post-accounting')
  @Permissions('view_courier_settlement', 'finalize_courier_settlement')
  postAccounting(@Param('id') id: string, @CurrentUser() user: User | null) {
    return this.finalize.repairAccounting(id, user?.userId ?? null);
  }

  // ── Exceptions ──

  @Post('exceptions/:id/acknowledge')
  @Permissions('view_courier_settlement', 'adjust_courier_settlement')
  acknowledge(
    @Param('id') id: string,
    @Query('invoiceId') invoiceId: string,
    @CurrentUser() user: User | null,
  ) {
    if (!invoiceId) throw new BadRequestException('invoiceId is required');
    return this.exceptions.acknowledge(invoiceId, id, user?.userId ?? null);
  }

  // ── Adjustments ──

  @Post('invoices/:id/adjustments')
  @Permissions('view_courier_settlement', 'adjust_courier_settlement')
  createAdjustment(
    @Param('id') id: string,
    @Body() dto: AdjustmentDto,
    @CurrentUser() user: User | null,
  ) {
    return this.adjustments.create({
      invoiceId: id,
      rowId: dto.rowId ?? null,
      adjustmentClass: dto.adjustmentClass,
      field: dto.field,
      adjustedValue: dto.adjustedValue ?? 0,
      reason: dto.reason,
      counterpart: dto.counterpart ?? null,
      actor: user?.userId ?? null,
    });
  }

  @Post('invoices/:id/adjustments/preview')
  @Permissions('view_courier_settlement')
  previewCorrection(@Param('id') _id: string, @Body() dto: CorrectionPreviewDto) {
    return this.adjustments.previewCorrection(dto.deltaG, dto.deltaC, dto.deltaN, dto.counterpart ?? null);
  }

  @Post('adjustments/:id/reverse')
  @Permissions('view_courier_settlement', 'adjust_courier_settlement')
  reverseAdjustment(
    @Param('id') id: string,
    @Body() dto: ReverseAdjustmentDto,
    @CurrentUser() user: User | null,
  ) {
    return this.adjustments.reverse(id, dto.reason, user?.userId ?? null);
  }

  // ── Reconciliation ──

  @Post('rows/:rowId/match')
  @Permissions('view_courier_settlement', 'adjust_courier_settlement')
  manualMatch(
    @Param('rowId') rowId: string,
    @Body() dto: ManualMatchDto,
    @CurrentUser() user: User | null,
  ) {
    return this.reconciliation.manualMatch(rowId, dto.orderId, dto.reason, user?.userId ?? null);
  }

  @Post('rows/:rowId/revalidate')
  @Permissions('view_courier_settlement')
  revalidate(@Param('rowId') rowId: string) {
    return this.reconciliation.revalidateRow(rowId);
  }

  @Get('finance-rules')
  @Permissions('view_courier_settlement')
  listFinanceRules() {
    return this.reconciliation.listFinanceRules();
  }

  @Post('finance-rules')
  @Permissions('view_courier_settlement', 'finalize_courier_settlement')
  approveFinanceRule(@Body() dto: FinanceRuleDto, @CurrentUser() user: User | null) {
    return this.reconciliation.approveFinanceRule({ ...dto, actor: user?.userId ?? null });
  }

  /**
   * §12 — "Test against sample rows": arithmetic preview of a CANDIDATE rule
   * against pasted sample numbers. Never evaluates a stored invoice formula.
   */
  @Post('finance-rules/test')
  @Permissions('view_courier_settlement', 'finalize_courier_settlement')
  testFinanceRule(@Body() dto: FinanceRuleTestDto) {
    return this.reconciliation.testFinanceRule(dto);
  }

  // ── Order cost projection ──

  @Get('orders/:orderId/cost-projection')
  @Permissions('view_courier_settlement')
  costProjection(@Param('orderId') orderId: string) {
    return this.cost.project(orderId);
  }
}