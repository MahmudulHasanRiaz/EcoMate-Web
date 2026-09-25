import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrderStatusController } from './order-status.controller';
import { OrdersService } from './orders.service';
import { OrderEditLockService } from './order-edit-lock.service';
import { OrdersEventService } from './orders-event.service';
import { TrackingModule } from '../tracking/tracking.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CouponsModule } from '../coupons/coupons.module';
import { BlockedEntriesModule } from '../blocked-entries/blocked-entries.module';
import { MarketingModule } from '../marketing/marketing.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { StoresModule } from '../stores/stores.module';

@Module({
  controllers: [OrdersController, OrderStatusController],
  providers: [OrdersService, OrdersEventService, OrderEditLockService],
  exports: [OrdersService, OrderEditLockService],
  imports: [
    TrackingModule,
    CustomersModule,
    InventoryModule,
    BlockedEntriesModule,
    CouponsModule,
    MarketingModule,
    CommissionsModule,
    // P7 §8.6: order hooks notify StoreOrderPushService post-commit
    // (acyclic: StoresModule never imports the orders module — ingest
    // resolves OrdersService lazily via ModuleRef).
    StoresModule,
  ],
})
export class OrdersModule {}
