import { Module } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { MetaConversionsService } from './meta-conversions.service';
import { TikTokEventsService } from './tiktok-events.service';
import { TrackingController } from './tracking.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TrackingController],
  providers: [TrackingService, MetaConversionsService, TikTokEventsService],
  exports: [TrackingService],
})
export class TrackingModule {}
