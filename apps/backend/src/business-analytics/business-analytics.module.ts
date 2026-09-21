import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { BusinessAnalyticsController } from './business-analytics.controller';
import { AnalyticsFilterService } from './analytics-filter.service';
import { AnalyticsPnlService } from './analytics-pnl.service';
import { AnalyticsFulfillmentService } from './analytics-fulfillment.service';
import { AnalyticsOverviewService } from './analytics-overview.service';
import { AnalyticsProductsService } from './analytics-products.service';
import { AnalyticsSalesService } from './analytics-sales.service';
import { AnalyticsCustomersService } from './analytics-customers.service';
import { AnalyticsMarketingService } from './analytics-marketing.service';
import { AnalyticsInventoryService } from './analytics-inventory.service';
import { AnalyticsExpensesService } from './analytics-expenses.service';
import { AnalyticsReconciliationService } from './analytics-reconciliation.service';

@Module({
  imports: [PrismaModule, InventoryModule],
  controllers: [BusinessAnalyticsController],
  providers: [
    AnalyticsFilterService,
    AnalyticsPnlService,
    AnalyticsFulfillmentService,
    AnalyticsOverviewService,
    AnalyticsProductsService,
    AnalyticsSalesService,
    AnalyticsCustomersService,
    AnalyticsMarketingService,
    AnalyticsInventoryService,
    AnalyticsExpensesService,
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
    AnalyticsMarketingService,
    AnalyticsInventoryService,
    AnalyticsExpensesService,
    AnalyticsReconciliationService,
  ],
})
export class BusinessAnalyticsModule {}
