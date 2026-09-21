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
import { Controller, Get, Query } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AnalyticsFilterDto } from './analytics-filter.dto';
import { AnalyticsPnlService } from './analytics-pnl.service';
import { AnalyticsFulfillmentService } from './analytics-fulfillment.service';
import { AnalyticsReconciliationService } from './analytics-reconciliation.service';

@Controller('business-analytics')
@RequiresFeature('admin_analytics')
@Roles('superadmin', 'admin', 'manager')
@Permissions('view_analytics')
export class BusinessAnalyticsController {
  constructor(
    private readonly pnlService: AnalyticsPnlService,
    private readonly fulfillmentService: AnalyticsFulfillmentService,
    private readonly reconciliationService: AnalyticsReconciliationService,
  ) {}

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
