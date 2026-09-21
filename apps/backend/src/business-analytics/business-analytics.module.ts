import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BusinessAnalyticsController } from './business-analytics.controller';
import { AnalyticsFilterService } from './analytics-filter.service';
import { AnalyticsPnlService } from './analytics-pnl.service';
import { AnalyticsFulfillmentService } from './analytics-fulfillment.service';
import { AnalyticsOverviewService } from './analytics-overview.service';
import { AnalyticsProductsService } from './analytics-products.service';
import { AnalyticsReconciliationService } from './analytics-reconciliation.service';

@Module({
  imports: [PrismaModule],
  controllers: [BusinessAnalyticsController],
  providers: [
    AnalyticsFilterService,
    AnalyticsPnlService,
    AnalyticsFulfillmentService,
    AnalyticsOverviewService,
    AnalyticsProductsService,
    AnalyticsReconciliationService,
  ],
  exports: [
    AnalyticsFilterService,
    AnalyticsPnlService,
    AnalyticsFulfillmentService,
    AnalyticsOverviewService,
    AnalyticsProductsService,
    AnalyticsReconciliationService,
  ],
})
export class BusinessAnalyticsModule {}
