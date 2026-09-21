/**
 * Business analytics controller (P2, §6 security).
 *
 * Repo convention: @Controller('business-analytics') (no leading slash; the
 * app sets a global 'api' prefix) + class @RequiresFeature('admin_analytics')
 * + @Roles('superadmin','admin','manager'), mirroring analytics.controller.ts.
 *
 * PermissionsGuard gotcha: getAllAndOverride([handler, class]) means handler
 * metadata REPLACES class metadata. The class carries the general
 * view_analytics grant; every financial handler (pnl, expenses, fulfillment,
 * reconciliation) therefore re-declares its FULL requirement explicitly —
 * view_analytics AND view_financial_summary. Frontend hiding is cosmetic only.
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AnalyticsFilterDto } from './analytics-filter.dto';
import { ProductsQueryDto } from './analytics-products.dto';
import { SalesQueryDto } from './analytics-sales.dto';
import { CustomersQueryDto } from './analytics-customers.dto';
import { AnalyticsPnlService } from './analytics-pnl.service';
import { AnalyticsFulfillmentService } from './analytics-fulfillment.service';
import { AnalyticsOverviewService } from './analytics-overview.service';
import { AnalyticsProductsService } from './analytics-products.service';
import { AnalyticsSalesService } from './analytics-sales.service';
import { AnalyticsCustomersService } from './analytics-customers.service';
import { AnalyticsMarketingService } from './analytics-marketing.service';
import { MarketingQueryDto } from './analytics-marketing.dto';
import { AnalyticsInventoryService } from './analytics-inventory.service';
import { InventoryQueryDto } from './analytics-inventory.dto';
import { AnalyticsReconciliationService } from './analytics-reconciliation.service';

@Controller('business-analytics')
@RequiresFeature('admin_analytics')
@Roles('superadmin', 'admin', 'manager')
@Permissions('view_analytics')
export class BusinessAnalyticsController {
  constructor(
    private readonly pnlService: AnalyticsPnlService,
    private readonly fulfillmentService: AnalyticsFulfillmentService,
    private readonly overviewService: AnalyticsOverviewService,
    private readonly productsService: AnalyticsProductsService,
    private readonly salesService: AnalyticsSalesService,
    private readonly customersService: AnalyticsCustomersService,
    private readonly marketingService: AnalyticsMarketingService,
    private readonly inventoryService: AnalyticsInventoryService,
    private readonly reconciliationService: AnalyticsReconciliationService,
  ) {}

  /** Composed Business Overview payload: pnl + fulfillment + trend + breakdowns + comparison (financial). */
  @Get('overview')
  @Permissions('view_analytics', 'view_financial_summary')
  overview(@Query() query: AnalyticsFilterDto) {
    return this.overviewService.getOverview(query);
  }

  /** Full P&L ladder + single-count bridge + lenses (financial). */
  @Get('pnl')
  @Permissions('view_analytics', 'view_financial_summary')
  pnl(@Query() query: AnalyticsFilterDto) {
    return this.pnlService.getPnl(query);
  }

  /** Operating-expense rollup by category + fixed/variable/unclassified. */
  @Get('expenses')
  @Permissions('view_analytics', 'view_financial_summary')
  expenses(@Query() query: AnalyticsFilterDto) {
    return this.pnlService.getExpensesSummary(query);
  }

  /** Fulfillment / courier economics panel (financial). */
  @Get('fulfillment')
  @Permissions('view_analytics', 'view_financial_summary')
  fulfillment(@Query() query: AnalyticsFilterDto) {
    return this.fulfillmentService.getFulfillment(query);
  }

  /** Product P&L list: parent/variant rows with basis labels (financial). */
  @Get('products/uncosted')
  @Permissions('view_analytics', 'view_financial_summary')
  uncostedProducts(@Query() query: ProductsQueryDto) {
    return this.productsService.getUncosted(query);
  }

  /** Product P&L list: parent rows with basis labels (financial). */
  @Get('products')
  @Permissions('view_analytics', 'view_financial_summary')
  products(@Query() query: ProductsQueryDto) {
    return this.productsService.getProducts(query);
  }

  /** Product detail: parent + variant P&L rows with performance trend (financial). */
  @Get('products/:id')
  @Permissions('view_analytics', 'view_financial_summary')
  productDetail(@Param('id') id: string, @Query() query: ProductsQueryDto) {
    return this.productsService.getProductDetail(id, query);
  }

  /** Reconciliation matrix + warnings (financial). */
  @Get('reconciliation')
  @Permissions('view_analytics', 'view_financial_summary')
  reconciliation(@Query() query: AnalyticsFilterDto) {
    return this.reconciliationService.runReconciliation(query);
  }

  /** Sales & Orders summary: lenses + order metrics + funnel + pipeline + breakdowns + economics (financial). */
  @Get('sales/summary')
  @Permissions('view_analytics', 'view_financial_summary')
  salesSummary(@Query() query: AnalyticsFilterDto) {
    return this.salesService.getSummary(query);
  }

  /** Sales funnel over the intake cohort — supported stages only (financial). */
  @Get('sales/funnel')
  @Permissions('view_analytics', 'view_financial_summary')
  salesFunnel(@Query() query: AnalyticsFilterDto) {
    return this.salesService.getFunnel(query);
  }

  /** Pre-delivery pipeline by stage — never revenue (financial). */
  @Get('sales/pipeline')
  @Permissions('view_analytics', 'view_financial_summary')
  salesPipeline(@Query() query: AnalyticsFilterDto) {
    return this.salesService.getPipeline(query);
  }

  /** Per-order settlement table, paginated, with inference disclosure (financial). */
  @Get('sales/settlement')
  @Permissions('view_analytics', 'view_financial_summary')
  salesSettlement(@Query() query: SalesQueryDto) {
    return this.salesService.getSettlement(query);
  }

  /** L1/L2/L3 lenses + recognition strip (general analytics). */
  @Get('lenses')
  @Permissions('view_analytics')
  lenses(@Query() query: AnalyticsFilterDto) {
    return this.pnlService.getLenses(query);
  }

  /** Customer acquisition + repeat + CLR summary (financial — revenue shown). */
  @Get('customers/summary')
  @Permissions('view_analytics', 'view_financial_summary')
  customersSummary(@Query() query: CustomersQueryDto) {
    return this.customersService.getSummary(query);
  }

  /** Acquisition-month × retention × cumulative CLR cohorts (financial). */
  @Get('customers/cohorts')
  @Permissions('view_analytics', 'view_financial_summary')
  customersCohorts(@Query() query: CustomersQueryDto) {
    return this.customersService.getCohorts(query);
  }

  /** Paginated customer rows for the §4.2 drill (financial — revenue shown). */
  @Get('customers')
  @Permissions('view_analytics', 'view_financial_summary')
  customersList(@Query() query: CustomersQueryDto) {
    return this.customersService.getCustomers(query);
  }

  /** Marketing P&L cost (spend-date) + attribution views (financial). */
  @Get('marketing/summary')
  @Permissions('view_analytics', 'view_financial_summary')
  marketingSummary(@Query() query: AnalyticsFilterDto) {
    return this.marketingService.getSummary(query);
  }

  /** Marketing campaign → ad set → ad tree over recorded rows (financial). */
  @Get('marketing/campaigns')
  @Permissions('view_analytics', 'view_financial_summary')
  marketingCampaigns(@Query() query: AnalyticsFilterDto) {
    return this.marketingService.getCampaigns(query);
  }

  /** Undated-spend coverage fix-list, paginated (financial). */
  @Get('marketing/undated')
  @Permissions('view_analytics', 'view_financial_summary')
  marketingUndated(@Query() query: MarketingQueryDto) {
    return this.marketingService.getUndated(query);
  }

  /** Inventory value: delegated close + reconstructed open + turnover (financial). */
  @Get('inventory/value')
  @Permissions('view_analytics', 'view_financial_summary')
  inventoryValue(@Query() query: InventoryQueryDto) {
    return this.inventoryService.getValue(query);
  }

  /** Movement classes per product/variant + default-policy label (general). */
  @Get('inventory/movement')
  @Permissions('view_analytics')
  inventoryMovement(@Query() query: InventoryQueryDto) {
    return this.inventoryService.getMovement(query);
  }

  /** Stock-out frequency + lost-sales honesty (general). */
  @Get('inventory/stockouts')
  @Permissions('view_analytics')
  inventoryStockouts(@Query() query: InventoryQueryDto) {
    return this.inventoryService.getStockouts(query);
  }

  /** Stock ledger drill-down: quantities only, never unitCost (general). */
  @Get('inventory/ledger')
  @Permissions('view_analytics')
  inventoryLedger(@Query() query: InventoryQueryDto) {
    return this.inventoryService.getLedger(query);
  }
}
