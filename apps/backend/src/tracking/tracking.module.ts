import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TrackingService } from './tracking.service';
import { MetaConversionsService } from './meta-conversions.service';
import { TikTokEventsService } from './tiktok-events.service';
import { Ga4MeasurementService } from './ga4-measurement.service';
import { GoogleAdsService } from './google-ads.service';
import { TrackingController } from './tracking.controller';
import { TrackingQueueService } from './tracking-queue.service';
import { TrackingQueueProcessor } from './tracking-queue.processor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: 'tracking' })],
  controllers: [TrackingController],
  providers: [
    TrackingService,
    MetaConversionsService,
    TikTokEventsService,
    Ga4MeasurementService,
    GoogleAdsService,
    TrackingQueueService,
    TrackingQueueProcessor,
  ],
  exports: [TrackingService],
})
export class TrackingModule {}
