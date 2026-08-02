import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TrackingContextService } from './tracking-context.service';
import { MetaConversionsService } from './meta-conversions.service';
import { TikTokEventsService } from './tiktok-events.service';
import { Ga4MeasurementService } from './ga4-measurement.service';
import { GoogleAdsService } from './google-ads.service';
import { TrackingController } from './tracking.controller';
import { TrackingQueueService } from './tracking-queue.service';
import { PageViewBufferService } from './page-view-buffer.service';
import { TrackingSettingsService } from './tracking-settings.service';
import { TrackingCaptureService } from './tracking-capture.service';
import { TrackingDispatcherService } from './tracking-dispatcher.service';
import { TrackingDispatcherProcessor } from './tracking-dispatcher.processor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: 'tracking' })],
  controllers: [TrackingController],
  providers: [
    TrackingContextService,
    MetaConversionsService,
    TikTokEventsService,
    Ga4MeasurementService,
    GoogleAdsService,
    TrackingQueueService,
    PageViewBufferService,
    TrackingSettingsService,
    TrackingCaptureService,
    TrackingDispatcherService,
    TrackingDispatcherProcessor,
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
