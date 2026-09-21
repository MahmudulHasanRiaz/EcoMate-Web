import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BusinessAnalyticsController } from './business-analytics.controller';
import { AnalyticsFilterService } from './analytics-filter.service';
import { AnalyticsPnlService } from './analytics-pnl.service';
import { AnalyticsFulfillmentService } from './analytics-fulfillment.service';
import { AnalyticsReconciliationService } from './analytics-reconciliation.service';

@Module({
  imports: [PrismaModule],
  controllers: [BusinessAnalyticsController],
  providers: [
    AnalyticsFilterService,
    AnalyticsPnlService,
    AnalyticsFulfillmentService,
    AnalyticsReconciliationService,
  ],
  exports: [
    AnalyticsFilterService,
    AnalyticsPnlService,
    AnalyticsFulfillmentService,
    AnalyticsReconciliationService,
  ],
})
export class BusinessAnalyticsModule {}
