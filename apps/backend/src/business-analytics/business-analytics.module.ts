import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BusinessAnalyticsController } from './business-analytics.controller';
import { AnalyticsFilterService } from './analytics-filter.service';
import { AnalyticsPnlService } from './analytics-pnl.service';
import { AnalyticsFulfillmentService } from './analytics-fulfillment.service';
import { AnalyticsOverviewService } from './analytics-overview.service';
import { AnalyticsProductsService } from './analytics-products.service';
import { AnalyticsSalesService } from './analytics-sales.service';
import { AnalyticsCustomersService } from './analytics-customers.service';
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
    AnalyticsSalesService,
    AnalyticsCustomersService,
    AnalyticsReconciliationService,
  ],
  exports: [
    AnalyticsFilterService,
    AnalyticsPnlService,
    AnalyticsFulfillmentService,
    AnalyticsOverviewService,
    AnalyticsProductsService,
    AnalyticsSalesService,
    AnalyticsCustomersService,
    AnalyticsReconciliationService,
  ],
})
export class BusinessAnalyticsModule {}
