/**
 * Store order operations — central-commerce P6 (§8.5, §10).
 *
 * - POST /stores/:id/sku-mappings — the one-click map action for an
 *   UNMATCHED_SKU issue: records the operator's SKU → product/variant target
 *   so future orders resolve. Never rewrites ingested items (BR-17).
 * - POST /stores/:id/reconcile-orders — manual bounded reconcile trigger
 *   (same 3-day default + opt-in widening bounds as the hourly job, BR-10).
 *   Returns `{ runId }` immediately; heavy work never runs inline (BR-21).
 *
 * Double-gated: license feature + runtime flags (BR-25).
 */
import { Body, Controller, ForbiddenException, NotFoundException, Param, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncRunService } from '../sync/sync-run.service';
import { SyncQueuesService } from '../sync/sync-queues.service';
import { StoreOrderIngestService } from './store-order-ingest.service';
import { orderSyncEnabled, storesEnabled } from '../store-flags';

export class MapSkuDto {
  @IsString() sku!: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() variantId?: string;
}

export class TriggerOrderReconcileDto {
  @IsOptional() @IsInt() @Min(1) @Max(30) windowDays?: number;
  @IsOptional() @IsString() wideningReason?: string;
}

function gate(): void {
  if (!storesEnabled() || !orderSyncEnabled()) {
    throw new ForbiddenException('Store order sync is disabled');
  }
}

@Roles('superadmin', 'admin', 'manager')
@Controller('stores')
@RequiresFeature('store_order_sync')
export class StoreOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: StoreOrderIngestService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
  ) {}

  @Post(':id/sku-mappings')
  @Roles('superadmin', 'admin')
  async mapSku(@Param('id') id: string, @Body() dto: MapSkuDto) {
    gate();
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('Unknown store');
    return this.ingest.mapSku(id, dto.sku, {
      productId: dto.productId,
      variantId: dto.variantId,
    });
  }

  @Post(':id/reconcile-orders')
  @Roles('superadmin', 'admin')
  async reconcileOrders(
    @Param('id') id: string,
    @Body() dto: TriggerOrderReconcileDto,
    @CurrentUser() user?: any,
  ) {
    gate();
    const run = await this.runs.begin({
      scope: 'RECONCILE' as any,
      triggerType: 'MANUAL',
      storeId: id,
      initiatedById: user?.sub,
      windowDays: dto.windowDays ?? 3,
      wideningReason: dto.wideningReason,
    });
    const runId = (run as any).id as string;
    await this.queues.enqueue(
      'store-reconcile',
      'order-reconcile',
      {
        runId,
        storeId: id,
        requestedDays: dto.windowDays,
        wideningReason: dto.wideningReason,
      },
      `order-reconcile:${id}:${runId}`,
    );
    return { runId };
  }
}
