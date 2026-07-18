import { Module, forwardRef } from '@nestjs/common';
import { CourierManagerController } from './courier-manager.controller';
import { CourierManagerService } from './courier-manager.service';
import { CourierWebhookController } from './courier-webhook.controller';
import { CourierWebhookService } from './courier-webhook.service';
import { CourierTrackingService } from './courier-tracking.service';
import { CourierCustomerHistoryController } from './courier-customer-history.controller';
import { CourierCustomerHistoryService } from './courier-customer-history.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  controllers: [CourierManagerController, CourierWebhookController, CourierCustomerHistoryController],
  providers: [CourierManagerService, CourierWebhookService, CourierTrackingService, CourierCustomerHistoryService],
  exports: [CourierTrackingService, CourierCustomerHistoryService],
  imports: [forwardRef(() => OrdersModule)],
})
export class CourierManagerModule {}
