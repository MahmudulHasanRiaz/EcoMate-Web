/**
 * Sync operations API — central-commerce §10 (P4).
 *
 * Runs/items/attempts/issues/product-history + overrides queue + retry.
 * Manual triggers return `{ runId }` immediately; heavy work never runs in
 * the HTTP request (BR-21). Double-gated: license feature + runtime flags.
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
  ) {
    gate();
    const where: any = {};
    if (storeId) where.storeId = storeId;
    if (scope) where.scope = scope;
    if (status) where.status = status;
    if (trigger) where.triggerType = trigger;
    if (from || to) {
      where.startedAt = {};
      if (from) where.startedAt.gte = new Date(from);
      if (to) where.startedAt.lte = new Date(to);
    }
    return this.prisma.syncRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: Math.min(Number(take ?? 50), 200),
      include: { _count: { select: { items: true } } },
    });
  }

  @Get('sync/runs/:id')
  async runDetail(@Param('id', ParseUUIDPipe) id: string) {
    gate();
    const run = await this.prisma.syncRun.findUnique({ where: { id }, include: { items: { take: 200, orderBy: { createdAt: 'desc' } } } });
    if (!run) return null;
    return run;
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

  @Get('sync/attempts')
  async attempts(@Query('storeId') storeId?: string, @Query('take') take?: string) {
    gate();
    // 90-day window (BR-19).
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    return this.prisma.syncAttempt.findMany({
      where: { ...(storeId ? { storeId } : {}), createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(take ?? 100), 500),
    });
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
}
