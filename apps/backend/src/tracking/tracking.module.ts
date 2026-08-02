import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TrackingContextService } from './tracking-context.service';
import { TrackingController } from './tracking.controller';
import { PageViewBufferService } from './page-view-buffer.service';
import { TrackingSettingsService } from './tracking-settings.service';
import { TrackingCaptureService } from './tracking-capture.service';
import { TrackingDispatcherService } from './tracking-dispatcher.service';
import { TrackingDispatcherProcessor } from './tracking-dispatcher.processor';
import { OutboxRelayService } from './outbox-relay.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: 'tracking' })],
  controllers: [TrackingController],
  providers: [
    TrackingContextService,
    PageViewBufferService,
    TrackingSettingsService,
    TrackingCaptureService,
    TrackingDispatcherService,
    TrackingDispatcherProcessor,
    OutboxRelayService,
  ],
  exports: [
    TrackingContextService,
    PageViewBufferService,
    TrackingSettingsService,
    TrackingCaptureService,
    TrackingDispatcherService,
  ],
})
export class TrackingModule {}
