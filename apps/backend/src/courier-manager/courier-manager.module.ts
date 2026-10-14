import { Module, forwardRef, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CourierManagerController } from './courier-manager.controller';
import { CourierManagerService } from './courier-manager.service';
import { CourierWebhookController } from './courier-webhook.controller';
import { CourierWebhookService } from './courier-webhook.service';
import { CourierTrackingService } from './courier-tracking.service';
import { CourierTokenService } from './courier-token.service';
import { SteadfastCredentialSetsService } from './steadfast-credential-sets.service';
import { EncryptionService } from '../common/utils/encryption';
import { CourierCustomerHistoryController } from './courier-customer-history.controller';
import { CourierCustomerHistoryService } from './courier-customer-history.service';
import { WebhookAttemptService } from './webhook-attempt.service';
import { WebhookRawBodyCapture } from './webhook-raw-body';
import { WebhookRateLimitCaptureMiddleware } from './webhook-rate-limit-capture.middleware';
import { OrdersModule } from '../orders/orders.module';
import { ReturnsModule } from '../returns/returns.module';

@Module({
  controllers: [CourierManagerController, CourierWebhookController, CourierCustomerHistoryController],
  providers: [CourierManagerService, CourierWebhookService, CourierTrackingService, CourierTokenService, CourierCustomerHistoryService, WebhookAttemptService, WebhookRateLimitCaptureMiddleware, WebhookRawBodyCapture, EncryptionService, SteadfastCredentialSetsService],
  exports: [CourierManagerService, CourierWebhookService, CourierTrackingService, CourierCustomerHistoryService, WebhookAttemptService, SteadfastCredentialSetsService],
  imports: [forwardRef(() => OrdersModule), ReturnsModule],
})
export class CourierManagerModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(WebhookRateLimitCaptureMiddleware)
      .forRoutes('webhooks/courier');
  }
}
