/**
 * Stores module — central-commerce P1 foundation + P3 distribution + P4 sync
 * + P6 order ingestion.
 *
 * P4: six sync queues (explicit concurrency + limiter each, R-8), the
 * ownership/conflict engine with the override workflow, category lifecycle,
 * sync-ops API and in-process processors (single-instance, no worker proc).
 * P6: route-scoped raw-body webhook receiver (HMAC, dedupe, replay guard),
 * the normalize-and-ingest worker, hourly bounded 3-day reconcile with
 * opt-in widening, and the read-only bridge contact-check (BR-14).
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { EncryptionService } from '../common/utils/encryption';
// NOTE: OrdersModule is deliberately NOT imported here. StockModule and
// InventoryModule (both imported by OrdersModule) import StoresModule, so a
// static StoresModule → OrdersModule edge is a file-level cycle. The ingest
// service resolves OrdersService lazily via ModuleRef instead (§8.5).
import { BlockedEntriesModule } from '../blocked-entries/blocked-entries.module';
import { CustomersModule } from '../customers/customers.module';
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
import { StockStatusSyncService } from './sync/stock-status-sync.service';
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
import { StoreOrderIngestService } from './orders/store-order-ingest.service';
import { StoreOrderReconcileService } from './orders/store-order-reconcile.service';
import { StoreOrderScheduler } from './orders/store-order-scheduler';
import { StoreOrdersController } from './orders/store-orders.controller';
import { StoreWebhookService } from './webhooks/store-webhook.service';
import { StoreWebhooksController } from './webhooks/store-webhooks.controller';
import { StoreBridgeController } from './webhooks/store-bridge.controller';
import { StoreWebhookRawBodyProvider } from './webhooks/store-webhook-rawbody.provider';

const SYNC_QUEUE_DEFAULTS = { removeOnComplete: 100, removeOnFail: 50, attempts: 1 };

@Module({
  imports: [
    PrismaModule,
    BlockedEntriesModule,
    CustomersModule,
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
    StoreOrdersController,
    StoreWebhooksController,
    StoreBridgeController,
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
    StockStatusSyncService,
    SyncQueuesService,
    StoreCircuitBreaker,
    StoreOrderIngestService,
    StoreOrderReconcileService,
    StoreOrderScheduler,
    StoreWebhookService,
    StoreWebhookRawBodyProvider,
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
    StockStatusSyncService,
    StoreOrderIngestService,
    StoreOrderReconcileService,
    StoreWebhookService,
  ],
})
export class StoresModule {}
