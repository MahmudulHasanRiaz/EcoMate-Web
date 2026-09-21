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
import { AnalyticsPnlService } from './analytics-pnl.service';
import { AnalyticsFulfillmentService } from './analytics-fulfillment.service';
import { AnalyticsOverviewService } from './analytics-overview.service';
import { AnalyticsProductsService } from './analytics-products.service';
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

  /** L1/L2/L3 lenses + recognition strip (general analytics). */
  @Get('lenses')
  @Permissions('view_analytics')
  lenses(@Query() query: AnalyticsFilterDto) {
    return this.pnlService.getLenses(query);
  }
}
