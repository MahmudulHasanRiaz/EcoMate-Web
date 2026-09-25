/**
 * Stores module — central-commerce P1 foundation + P3 distribution + P4 sync.
 *
 * P4: six sync queues (explicit concurrency + limiter each, R-8), the
 * ownership/conflict engine with the override workflow, category lifecycle,
 * sync-ops API and in-process processors (single-instance, no worker proc).
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { EncryptionService } from '../common/utils/encryption';
import { StoresService } from './stores.service';
import { StoresController } from './stores.controller';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { WooCommerceProvider } from './providers/woocommerce.provider';
import { ShopifyProvider } from './providers/shopify.provider';
import { CustomBridgeProvider } from './providers/custom-bridge.provider';
import { StoreAvailabilityService } from './distribution/store-availability.service';
import { FieldOwnershipService } from './distribution/field-ownership.service';
import { DistributionService } from './distribution/distribution.service';
import {
  ProductStoreAvailabilityController,
  StoreAvailabilityRulesController,
} from './distribution/distribution.controller';
import { SyncRunService } from './sync/sync-run.service';
import { CategorySyncService } from './sync/category-sync.service';
import { ProductSyncService } from './sync/product-sync.service';
import { SyncQueuesService } from './sync/sync-queues.service';
import { StoreCircuitBreaker } from './sync/sync-circuit';
import {
  StoreMaintenanceProcessor,
  StoreOrderIngestProcessor,
  StoreOrderPushProcessor,
  StoreProductSyncProcessor,
  StoreReconcileProcessor,
  StoreStockSyncProcessor,
} from './sync/sync.processors';
import { SyncOpsController } from './sync/sync-ops.controller';
import { StoreOverridesController } from './sync/store-overrides.controller';

const SYNC_QUEUE_DEFAULTS = { removeOnComplete: 100, removeOnFail: 50, attempts: 1 };

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue(
      { name: 'store-product-sync', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-stock-sync', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-order-ingest', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-order-push', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-reconcile', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-maintenance', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
    ),
  ],
  controllers: [
    StoresController,
    ProductStoreAvailabilityController,
    StoreAvailabilityRulesController,
    SyncOpsController,
    StoreOverridesController,
  ],
  providers: [
    StoresService,
    ProviderRegistryService,
    WooCommerceProvider,
    ShopifyProvider,
    CustomBridgeProvider,
    EncryptionService,
    StoreAvailabilityService,
    FieldOwnershipService,
    DistributionService,
    SyncRunService,
    CategorySyncService,
    ProductSyncService,
    SyncQueuesService,
    StoreCircuitBreaker,
    StoreProductSyncProcessor,
    StoreStockSyncProcessor,
    StoreOrderIngestProcessor,
    StoreOrderPushProcessor,
    StoreReconcileProcessor,
    StoreMaintenanceProcessor,
  ],
  exports: [
    StoresService,
    ProviderRegistryService,
    StoreAvailabilityService,
    DistributionService,
    SyncRunService,
    ProductSyncService,
    SyncQueuesService,
  ],
})
export class StoresModule {}
