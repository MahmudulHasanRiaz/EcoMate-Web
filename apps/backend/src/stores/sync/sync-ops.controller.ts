/**
 * Sync operations API — central-commerce §10 (P4) + P11 operations.
 *
 * Runs/items/attempts/issues/product-history + overrides queue + retry.
 * Manual triggers return `{ runId }` immediately; heavy work never runs in
 * the HTTP request (BR-21). Double-gated: license feature + runtime flags.
 *
 * P11 (additive): provider + initiator run filters, `widenedWindow` alias
 * on run payloads, retry-now/selected/all-eligible + attempt ignore with
 * notes, store health grid, override audit history, retention status +
 * manual purge trigger.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncRunService } from './sync-run.service';
import { SyncQueuesService } from './sync-queues.service';
import { SyncRetryService } from './sync-retry.service';
import {
  HEALTH_CHECK_RETENTION_DAYS,
  SYNC_ATTEMPT_RETENTION_DAYS,
  SYNC_ISSUE_RESOLVED_RETENTION_DAYS,
  SYNC_RUN_RETENTION_DAYS,
  WEBHOOK_DELIVERY_RETENTION_DAYS,
} from './sync-retention.service';
import { productSyncEnabled, storesEnabled } from '../store-flags';

export class TriggerSyncDto {
  @IsOptional()
  @IsIn(['PRODUCT', 'PUBLISH', 'STOCK', 'RECONCILE'])
  scope?: string;
}

export class RetryOverridesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  overrideIds!: string[];
}

export class ResolveIssueDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class RetryAttemptsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  attemptIds!: string[];
}

export class RetryAllDto {
  @IsOptional()
  @IsUUID('4')
  storeId?: string;
}

export class IgnoreAttemptDto {
  @IsOptional()
  @IsString()
  note?: string;
}

function gate(): void {
  if (!storesEnabled() || !productSyncEnabled()) {
    throw new ForbiddenException('Product sync is disabled');
  }
}

@Roles('superadmin', 'admin', 'manager')
@Controller()
@RequiresFeature('admin_sync_center')
export class SyncOpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly retry: SyncRetryService,
  ) {}

  @Post('stores/sync-all')
  @Roles('superadmin', 'admin')
  async syncAll(@Body() dto: TriggerSyncDto, @CurrentUser() user?: any) {
    gate();
    const scope = (dto.scope ?? 'PRODUCT') as 'PRODUCT' | 'PUBLISH';
    // NATIVE excluded structurally: fan-out filters kind !== 'NATIVE' and
    // reports excludedNativeCount (BR-20).
    const stores = await this.prisma.store.findMany({ select: { id: true, kind: true } });
    const external = (stores as any[]).filter((s) => s.kind !== 'NATIVE');
    const excludedNativeCount = (stores as any[]).length - external.length;
    const batch = await this.runs.begin({ scope: scope as any, triggerType: 'MANUAL', initiatedById: user?.sub });
    const batchRunId = (batch as any).id as string;
    const childRunIds: string[] = [];
    for (const store of external.slice(0, 500)) {
      const child = await this.runs.begin({ scope: scope as any, triggerType: 'MANUAL', storeId: store.id, initiatedById: user?.sub });
      childRunIds.push((child as any).id);
      await this.queues.enqueue('store-product-sync', 'store-sync', { runId: (child as any).id, storeId: store.id }, `store-sync:${(child as any).id}`);
    }
    await this.runs.finish(batchRunId, { created: childRunIds.length, updated: 0, skipped: excludedNativeCount, failed: 0 });
    return { batchRunId, childRunIds, excludedNativeCount };
  }

  @Post('sync/publish')
  @Roles('superadmin', 'admin')
  async publish(@Body() dto: TriggerSyncDto, @CurrentUser() user?: any) {
    gate();
    void dto;
    const run = await this.runs.begin({ scope: 'PUBLISH' as any, triggerType: 'MANUAL', initiatedById: user?.sub });
    const runId = (run as any).id as string;
    await this.queues.enqueue('store-product-sync', 'sync-all', { batchRunId: runId, scope: 'PUBLISH' }, `sync-all:${runId}`);
    return { runId };
  }

  @Get('sync/runs')
  async runsList(
    @Query('storeId') storeId?: string,
    @Query('scope') scope?: string,
    @Query('status') status?: string,
    @Query('trigger') trigger?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
    @Query('provider') provider?: string,
    @Query('initiatedBy') initiatedBy?: string,
  ) {
    gate();
    const where: any = {};
    if (storeId) where.storeId = storeId;
    if (scope) where.scope = scope;
    if (status) where.status = status;
    if (trigger) where.triggerType = trigger;
    if (initiatedBy) where.initiatedById = initiatedBy;
    // Provider filter (§10): SyncRun has no provider column (additive-only —
    // no migration in P11), so filter through the store relation's kind.
    if (provider) where.store = { kind: provider };
    if (from || to) {
      where.startedAt = {};
      if (from) where.startedAt.gte = new Date(from);
      if (to) where.startedAt.lte = new Date(to);
    }
    const rows = await this.prisma.syncRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: Math.min(Number(take ?? 50), 200),
      include: { _count: { select: { items: true } }, store: { select: { id: true, kind: true, name: true } } },
    });
    // Additive alias: widenedWindow alongside the raw columns.
    return (rows as any[]).map((r) => ({
      ...r,
      provider: (r as any).store?.kind ?? null,
      widenedWindow: r.windowDays != null ? { days: r.windowDays, reason: (r as any).wideningReason ?? null } : null,
    }));
  }

  @Get('sync/runs/:id')
  async runDetail(@Param('id', ParseUUIDPipe) id: string) {
    gate();
    const run = await this.prisma.syncRun.findUnique({
      where: { id },
      include: { items: { take: 200, orderBy: { createdAt: 'desc' } }, store: { select: { id: true, kind: true, name: true } } },
    });
    if (!run) return null;
    return {
      ...run,
      provider: (run as any).store?.kind ?? null,
      widenedWindow:
        (run as any).windowDays != null
          ? { days: (run as any).windowDays, reason: (run as any).wideningReason ?? null }
          : null,
    };
  }

  @Get('sync/runs/:id/items')
  async runItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('objectType') objectType?: string,
    @Query('status') status?: string,
  ) {
    gate();
    const where: any = { runId: id };
    if (objectType) where.objectType = objectType;
    if (status) where.status = status;
    return this.prisma.syncRunItem.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  @Post('sync/runs/:id/cancel')
  @Roles('superadmin', 'admin')
  async cancelRun(@Param('id', ParseUUIDPipe) id: string) {
    gate();
    return this.runs.cancel(id);
  }

  @Get('sync/issues')
  async issues(@Query('storeId') storeId?: string, @Query('status') status?: string) {
    gate();
    return this.prisma.storeSyncIssue.findMany({
      where: { ...(storeId ? { storeId } : {}), ...(status ? { status: status as any } : {}) },
      orderBy: { lastSeenAt: 'desc' },
      take: 500,
    });
  }

  @Post('sync/issues/:id/resolve')
  @Roles('superadmin', 'admin')
  async resolveIssue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveIssueDto) {
    gate();
    return this.prisma.storeSyncIssue.update({
      where: { id },
      data: { status: 'RESOLVED' as any, resolvedAt: new Date(), resolveNote: dto.note },
    });
  }

  @Post('sync/issues/:id/ignore')
  @Roles('superadmin', 'admin')
  async ignoreIssue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveIssueDto) {
    gate();
    return this.prisma.storeSyncIssue.update({
      where: { id },
      data: { status: 'IGNORED' as any, resolvedAt: new Date(), resolveNote: dto.note },
    });
  }

  @Get('sync/product-history')
  async productHistory(@Query('storeId') storeId: string, @Query('productId') productId: string) {
    gate();
    const [states, items, mapping] = await Promise.all([
      this.prisma.productStoreFieldState.findMany({ where: { storeId, productId }, orderBy: { field: 'asc' } }),
      this.prisma.syncRunItem.findMany({ where: { storeId, productId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      (this.prisma as any).storeProductMapping.findUnique({ where: { storeId_productId: { storeId, productId } } }),
    ]);
    return { storeId, productId, mapping, states, items };
  }

  @Get('sync/overrides')
  async overridesQueue(@Query('storeId') storeId?: string) {
    gate();
    // The conflicts + external-override queue: EXTERNAL/CONFLICT field states.
    return this.prisma.productStoreFieldState.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        ownership: { in: ['EXTERNAL', 'CONFLICT'] as any },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
  }

  @Post('sync/overrides/retry')
  @Roles('superadmin', 'admin')
  async retryOverrides(@Body() dto: RetryOverridesDto) {
    gate();
    // Retry NEVER resolves (BR-26): re-read external and re-evaluate only.
    // Field-state rows addressed by id are re-queued for evaluation; rows
    // that are still drifted stay EXTERNAL/CONFLICT afterwards.
    const rows = await this.prisma.productStoreFieldState.findMany({ where: { id: { in: dto.overrideIds } } });
    const requeued = rows.length;
    for (const row of rows as any[]) {
      await this.runs.recordAttempt({
        storeId: row.storeId,
        objectType: 'PRODUCT',
        objectKey: `store:${row.storeId}:product:${row.productId}:field:${row.field}`,
        productId: row.productId,
        field: row.field,
        status: 'PENDING',
        errorMessage: 'override-retry: re-evaluate only, never resolve (BR-26)',
      });
    }
    return { requeued, resolved: 0 };
  }

  // ── P11 retry center (provider-independent) ──────────────────────────

  @Get('sync/attempts')
  async attempts(
    @Query('storeId') storeId?: string,
    @Query('take') take?: string,
    @Query('status') status?: string,
    @Query('objectType') objectType?: string,
  ) {
    gate();
    // 90-day window (BR-19).
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    return this.prisma.syncAttempt.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        ...(status ? { status: status as any } : {}),
        ...(objectType ? { objectType: objectType as any } : {}),
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(take ?? 100), 500),
    });
  }

  @Post('sync/attempts/:id/retry')
  @Roles('superadmin', 'admin')
  async retryAttempt(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: any) {
    gate();
    return this.retry.retryOne(id, user?.sub);
  }

  @Post('sync/attempts/retry')
  @Roles('superadmin', 'admin')
  async retryAttempts(@Body() dto: RetryAttemptsDto, @CurrentUser() user?: any) {
    gate();
    return this.retry.retryByIds(dto.attemptIds, user?.sub);
  }

  @Post('sync/attempts/retry-all')
  @Roles('superadmin', 'admin')
  async retryAll(@Body() dto: RetryAllDto, @CurrentUser() user?: any) {
    gate();
    return this.retry.retryAllEligible(dto.storeId, user?.sub);
  }

  @Post('sync/attempts/:id/ignore')
  @Roles('superadmin', 'admin')
  async ignoreAttempt(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IgnoreAttemptDto) {
    gate();
    return this.retry.ignoreAttempt(id, dto.note);
  }

  // ── P11 health grid (§12 observability) ──────────────────────────────

  @Get('sync/health')
  async healthGrid(@Query('kind') kind?: string) {
    gate();
    const stores = await this.prisma.store.findMany({
      where: { ...(kind ? { kind: kind as any } : {}) },
      orderBy: { name: 'asc' },
      select: {
        id: true, kind: true, name: true, status: true, healthState: true,
        lastSyncAt: true, lastHealthCheckAt: true, lastError: true,
      },
      take: 200,
    });
    const rows: any[] = [];
    for (const s of stores as any[]) {
      const [check, openIssues, activeRuns] = await Promise.all([
        this.prisma.storeHealthCheck.findFirst({ where: { storeId: s.id }, orderBy: { checkedAt: 'desc' } }),
        (this.prisma as any).storeSyncIssue.count({ where: { storeId: s.id, status: 'OPEN' } }).catch(() => 0),
        this.prisma.syncRun.count({ where: { storeId: s.id, status: 'RUNNING' } }).catch(() => 0),
      ]);
      rows.push({
        storeId: s.id,
        name: s.name,
        kind: s.kind,
        provider: s.kind,
        status: s.status,
        healthState: s.healthState,
        lastSyncAt: s.lastSyncAt,
        lastHealthCheckAt: s.lastHealthCheckAt,
        lastError: s.lastError,
        latestCheck: check,
        openIssues,
        activeRuns,
      });
    }
    return rows;
  }

  // ── P11 override audit history (BR-04 trail) ─────────────────────────

  @Get('sync/overrides/history')
  async overridesHistory(@Query('storeId') storeId?: string, @Query('take') take?: string) {
    gate();
    // Every Force/Keep writes a SyncRunItem with reason `override:<action>
    // actor=… prevExternal=… prevBaseline=…` (P4 auditOverride) — this view
    // surfaces that trail. Additive: no new table.
    return this.prisma.syncRunItem.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        reason: { startsWith: 'override:' },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(take ?? 100), 500),
    });
  }

  // ── P11 retention observability (BR-19) ──────────────────────────────

  @Get('sync/retention/status')
  async retentionStatus() {
    gate();
    const lastPurge = await this.prisma.syncRun.findFirst({
      where: { scope: 'MAINTENANCE' as any },
      orderBy: { startedAt: 'desc' },
    });
    return {
      policy: {
        syncRunsDays: SYNC_RUN_RETENTION_DAYS,
        syncRunItemsDays: SYNC_RUN_RETENTION_DAYS,
        syncAttemptsDays: SYNC_ATTEMPT_RETENTION_DAYS,
        resolvedIgnoredIssuesDays: SYNC_ISSUE_RESOLVED_RETENTION_DAYS,
        openIssues: 'kept-compact-never-purged',
        webhookDeliveriesDays: WEBHOOK_DELIVERY_RETENTION_DAYS,
        healthChecksDays: HEALTH_CHECK_RETENTION_DAYS,
      },
      lastPurgeRun: lastPurge,
    };
  }

  @Post('sync/retention/purge')
  @Roles('superadmin', 'admin')
  async triggerPurge(@CurrentUser() user?: any) {
    gate();
    // BR-21: enqueue only — the bounded purge runs in the worker.
    void user;
    await this.queues.enqueue('store-maintenance', 'retention-purge', { triggeredAt: new Date().toISOString() }, `retention-purge:${Date.now()}`);
    return { enqueued: true };
  }
}
