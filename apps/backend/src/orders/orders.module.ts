import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrderStatusController } from './order-status.controller';
import { OrdersService } from './orders.service';
import { OrderOthersService } from './order-others.service';
import { OrderEditLockService } from './order-edit-lock.service';
import { OrdersEventService } from './orders-event.service';
import { OrderStaffPerformanceService } from './order-staff-performance.service';
import { TrackingModule } from '../tracking/tracking.module';
import { CustomersModule } from '../customers/customers.module';
import { SalesChannelModule } from '../sales-channel/sales-channel.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CouponsModule } from '../coupons/coupons.module';
import { BlockedEntriesModule } from '../blocked-entries/blocked-entries.module';
import { MarketingModule } from '../marketing/marketing.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { CodMismatchModule } from '../cod-mismatch/cod-mismatch.module';
import { DispatchCancelModule } from '../dispatch-cancel/dispatch-cancel.module';

@Module({
  controllers: [OrdersController, OrderStatusController],
  providers: [
    OrdersService,
    OrdersEventService,
    OrderEditLockService,
    OrderOthersService,
    OrderStaffPerformanceService,
  ],
  exports: [
    OrdersService,
    OrderEditLockService,
    OrdersEventService,
    OrderOthersService,
    OrderStaffPerformanceService,
  ],
  imports: [
    TrackingModule,
    CustomersModule,
    SalesChannelModule,
    InventoryModule,
    BlockedEntriesModule,
    CouponsModule,
    MarketingModule,
    CommissionsModule,
    CodMismatchModule,
    DispatchCancelModule,
  ],
})
export class OrdersModule {}
