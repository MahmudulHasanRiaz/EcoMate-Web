import { Module, forwardRef } from '@nestjs/common';
import { CourierManagerController } from './courier-manager.controller';
import { CourierManagerService } from './courier-manager.service';
import { CourierWebhookController } from './courier-webhook.controller';
import { CourierWebhookService } from './courier-webhook.service';
import { CourierTrackingService } from './courier-tracking.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  controllers: [CourierManagerController, CourierWebhookController],
  providers: [CourierManagerService, CourierWebhookService, CourierTrackingService],
  exports: [CourierTrackingService],
  imports: [forwardRef(() => OrdersModule)],
})
export class CourierManagerModule {}
