import { Module } from '@nestjs/common';
import { CourierManagerController } from './courier-manager.controller';
import { CourierManagerService } from './courier-manager.service';
import { CourierWebhookController } from './courier-webhook.controller';
import { CourierWebhookService } from './courier-webhook.service';

@Module({
  controllers: [CourierManagerController, CourierWebhookController],
  providers: [CourierManagerService, CourierWebhookService],
})
export class CourierManagerModule {}
