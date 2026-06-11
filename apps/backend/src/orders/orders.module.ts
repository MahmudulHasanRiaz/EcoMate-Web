import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersEventService } from './orders-event.service';
import { TrackingModule } from '../tracking/tracking.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersEventService],
  imports: [TrackingModule, CustomersModule, InventoryModule],
})
export class OrdersModule {}
