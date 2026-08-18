import { Module, forwardRef, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CourierManagerController } from './courier-manager.controller';
import { CourierManagerService } from './courier-manager.service';
import { CourierWebhookController } from './courier-webhook.controller';
import { CourierWebhookService } from './courier-webhook.service';
import { CourierTrackingService } from './courier-tracking.service';
import { CourierTokenService } from './courier-token.service';
import { CourierCustomerHistoryController } from './courier-customer-history.controller';
import { CourierCustomerHistoryService } from './courier-customer-history.service';
import { WebhookAttemptService } from './webhook-attempt.service';
import { WebhookRateLimitCaptureMiddleware } from './webhook-rate-limit-capture.middleware';
import { OrdersModule } from '../orders/orders.module';

@Module({
  controllers: [CourierManagerController, CourierWebhookController, CourierCustomerHistoryController],
  providers: [CourierManagerService, CourierWebhookService, CourierTrackingService, CourierTokenService, CourierCustomerHistoryService, WebhookAttemptService, WebhookRateLimitCaptureMiddleware],
  exports: [CourierTrackingService, CourierCustomerHistoryService, WebhookAttemptService],
  imports: [forwardRef(() => OrdersModule)],
})
export class CourierManagerModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(WebhookRateLimitCaptureMiddleware)
      .forRoutes('webhooks/courier');
  }
}
