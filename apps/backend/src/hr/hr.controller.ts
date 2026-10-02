import { Controller, Get, Post, Query, Param } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { HrService } from './hr.service';
import { OrderStaffPerformanceService } from '../orders/order-staff-performance.service';
import { TasksService } from '../tasks/tasks.service';

@Controller('hr')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('view_hr')
@RequiresFeature('admin_hr')
export class HrController {
  constructor(
    private readonly hrService: HrService,
    private readonly staffPerformance: OrderStaffPerformanceService,
    private readonly tasksService: TasksService,
  ) {}

  @Get('overview')
  getOverview() {
    return this.hrService.getOverview();
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
      page: page ? parseInt(page) : 1,
      perPage: perPage ? parseInt(perPage) : 20,
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
      page: page ? parseInt(page) : 1,
      perPage: perPage ? parseInt(perPage) : 20,
    });
  }

  /**
   * POST /hr/performance/orders/backfill
   * One-time backfill: migrate existing Order.timeline entries into OrderStaffEvent.
   */
  @Post('performance/orders/backfill')
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
      page: page ? parseInt(page) : 1,
      perPage: perPage ? parseInt(perPage) : 20,
    });
  }
}