import { Controller, Get, Post, Query, Param } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { HrService } from './hr.service';
import { OrderStaffPerformanceService } from '../orders/order-staff-performance.service';
import { TasksService } from '../tasks/tasks.service';

/**
 * Page size cap for the analytics endpoints.
 *
 * `perPage` came straight off the query string with no upper bound, so
 * `?perPage=100000` widened the in-memory `id IN (...)` list in
 * getStaffPerformance until it exceeded Postgres' bind-parameter budget. It
 * also controls how much timeline JSONB is pulled per request. 200 covers any
 * realistic page size for a manager-facing report.
 */
const MAX_PER_PAGE = 200;

function toPage(value?: string): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function toPerPage(value?: string): number {
  const n = parseInt(value ?? '20', 10);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(n, MAX_PER_PAGE);
}

@Controller('hr')
@Roles('superadmin', 'admin', 'employee')
@PermissionsAny('view_hr')
@RequiresFeature('admin_hr')
export class HrController {
  constructor(
    private readonly hrService: HrService,
    private readonly staffPerformance: OrderStaffPerformanceService,
    private readonly tasksService: TasksService,
  ) {}

  @Get('overview')
  @PermissionsAny('manage_payroll')
  getOverview() {
    // Payroll figures (lastPeriodNet, paidThisMonth, payable, recentPayments
    // netPay) are returned inside this payload. They used to be served under
    // the class-level view_hr permission alone, so anyone who could read the HR
    // directory could also read salary data — while hr-ledgers requires
    // manage_payroll for exactly the same numbers. Split the two so operational
    // HR and payroll access stay separable, as they already are everywhere else.
    return this.hrService.getOverview();
  }

  /**
   * GET /hr/overview/workforce
   * The same dashboard without any payroll figures, for managers who hold
   * view_hr but not manage_payroll.
   */
  @Get('overview/workforce')
  getWorkforceOverview() {
    return this.hrService.getOverview({ includePayroll: false });
  }

  // ── Order Staff Performance ─────────────────────────────────────────────────

  /**
   * GET /hr/performance/orders
   * Per-employee order funnel metrics.
   * Metric definitions (documented in OrderStaffPerformanceService):
   *   - Confirmation Rate = Confirmed / Orders Handled
   *   - Delivery Rate = Delivered / Confirmed
   *   - End-to-End Delivery Rate = Delivered / Orders Handled
   *   - Return Rate = Returned / Delivered
   *   - Cancellation Rate = Cancelled / Orders Handled
   */
  @Get('performance/orders')
  getOrderPerformance(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('employeeId') employeeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.staffPerformance.getStaffPerformance({
      from,
      to,
      employeeId,
      departmentId,
      page: toPage(page),
      perPage: toPerPage(perPage),
    });
  }

  /**
   * GET /hr/performance/orders/:employeeId/drilldown
   * Per-employee drill-down: list orders in each stage cohort.
   */
  @Get('performance/orders/:employeeId/drilldown')
  getOrderDrilldown(
    @Param('employeeId') employeeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('stage') stage?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.staffPerformance.getStaffOrderDrilldown({
      employeeId,
      from,
      to,
      stage: stage as any,
      page: toPage(page),
      perPage: toPerPage(perPage),
    });
  }

  /**
   * POST /hr/performance/orders/backfill
   * One-time backfill: migrate existing Order.timeline entries into OrderStaffEvent.
   *
   * Restricted to superadmin/admin rather than the class-level employee role.
   * This is an unbounded bulk write (2000 orders x their timeline entries) with
   * no rate limit, so a read-only HR viewer should not be able to trigger it —
   * orders.controller.ts already requires superadmin/admin for the analogous
   * backfill-view-tokens maintenance endpoint.
   */
  @Post('performance/orders/backfill')
  @PermissionsAny('manage_hr_settings')
  backfillOrderEvents() {
    return this.staffPerformance.backfillFromTimeline();
  }

  // ── Task Productivity ────────────────────────────────────────────────────────

  /**
   * GET /hr/performance/tasks
   * Per-employee task productivity report.
   * Date semantics:
   *   - assigned = Task.createdAt within date range
   *   - completed = Task.status=done AND Task.updatedAt within date range
   *   - timeSpent = TaskTimeEntry.startedAt within date range
   */
  @Get('performance/tasks')
  getTaskPerformance(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.tasksService.getProductivityReport({
      from,
      to,
      departmentId,
      employeeId,
      page: toPage(page),
      perPage: toPerPage(perPage),
    });
  }
}