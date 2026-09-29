import { Module } from '@nestjs/common';
import { PosAnalyticsController } from './pos-analytics.controller';
import { PosAnalyticsService } from './pos-analytics.service';

@Module({
  controllers: [PosAnalyticsController],
  providers: [PosAnalyticsService],
})
export class PosAnalyticsModule {}
