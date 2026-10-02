import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dhakaToday, dhakaStartOfDay } from '../hr-attendance/attendance-date';
import { OrderStaffPerformanceService } from '../orders/order-staff-performance.service';

const toNumber = (value: { toString(): string } | null | undefined): number =>
  value ? Number(value) : 0;

@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    // The order funnel has exactly one definition, and it lives in the
    // performance service. Counting OrderStaffEvent rows inline here would
    // drift from it immediately — and it did: the literals below were
    // 'ASSIGNED'/'STATUS_CHANGED', which no code path has ever written, so
    // every number rendered as a silent 0.
    private readonly staffPerformance: OrderStaffPerformanceService,
  ) {}

  /**
   * HR dashboard payload.
   *
   * `includePayroll: false` skips the payroll queries entirely and omits the
   * figures, for callers who hold view_hr but not manage_payroll. Gating only
   * the response would still have run the queries.
   */
  async getOverview(opts: { includePayroll?: boolean } = {}) {
    const includePayroll = opts.includePayroll !== false;
    const now = new Date();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // Today's date stored-convention UTC midnight (Dhaka calendar date)
    const todayStr = dhakaToday(now);
    const todayDate = dhakaStartOfDay(todayStr);

    const [
      employeeCounts,
      pendingApprovals,
      paidThisMonth,
      lastPeriodPayslip,
      payable,
      recentPayments,
      // Attendance today
      attendanceToday,
      attendanceTotals,
      // Live session states — AttendanceSession with no checkOutAt = active
      activeSessions,
      // Pending leaves
      pendingLeaves,
      // Tasks KPIs
      tasksCreatedToday,
      tasksCompletedToday,
      tasksPending,
    ] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.payslip.count({ where: { status: { in: ['draft', 'reviewed'] } } }),
      this.prisma.payslip.aggregate({
        where: { status: 'paid', paidAt: { gte: monthStart } },
        _sum: { netPay: true },
      }),
      this.prisma.payslip.findFirst({
        where: { status: { in: ['paid', 'approved'] }, periodKey: { not: null } },
        orderBy: { periodStart: 'desc' },
        select: { periodKey: true },
      }),
      this.prisma.payslip.aggregate({
        where: { status: { in: ['approved', 'partially_paid'] } },
        _sum: { netPay: true },
      }),
      this.prisma.payslip.findMany({
        where: { paidAt: { not: null } },
        orderBy: { paidAt: 'desc' },
        take: 5,
        select: {
          id: true,
          netPay: true,
          paidAt: true,
          periodKey: true,
          employee: {
            select: {
              employeeId: true,
              betterAuthUser: { select: { name: true } },
            },
          },
        },
      }),
      // Attendance day status counts for today
      this.prisma.attendanceDay.groupBy({
        by: ['status'],
        where: { date: todayDate },
        _count: { _all: true },
      }),
      // Worked + break minutes totals for today
      this.prisma.attendanceDay.aggregate({
        where: { date: todayDate },
        _sum: { workedMinutes: true, breakMinutes: true, overtimeMinutes: true },
      }),
      // Live sessions (active = no checkOutAt, not on break)
      this.prisma.attendanceSession.findMany({
        where: { day: { date: todayDate }, checkOutAt: null },
        include: {
          breaks: { where: { endedAt: null }, select: { id: true } },
        },
      }),
      this.prisma.leaveRequest.count({ where: { status: 'pending' } }),
      // Tasks today
      this.prisma.task.count({
        where: { createdAt: { gte: todayDate, lt: new Date(todayDate.getTime() + 86400000) } },
      }),
      this.prisma.task.count({
        where: { status: 'done', updatedAt: { gte: todayDate, lt: new Date(todayDate.getTime() + 86400000) } },
      }),
      this.prisma.task.count({ where: { status: { notIn: ['done', 'canceled'] } } }),
    ]);

    const total = employeeCounts.reduce((sum, row) => sum + row._count._all, 0);
    const byStatus = (name: string) =>
      employeeCounts.find((row) => row.status === name)?._count._all ?? 0;

    let lastPeriodKey: string | null = null;
    let lastPeriodNet = 0;
    if (lastPeriodPayslip?.periodKey) {
      lastPeriodKey = lastPeriodPayslip.periodKey;
      const lastPeriodSum = await this.prisma.payslip.aggregate({
        where: { periodKey: lastPeriodKey, status: { in: ['paid', 'approved'] } },
        _sum: { netPay: true },
      });
      lastPeriodNet = toNumber(lastPeriodSum._sum.netPay);
    }

    // Attendance: status counts for today
    const attCounts: Record<string, number> = {
      PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, ON_LEAVE: 0, WEEKLY_OFF: 0,
    };
    let attTotal = 0;
    for (const row of attendanceToday) {
      attCounts[row.status] = row._count._all;
      attTotal += row._count._all;
    }

    // Live state from sessions with no checkout
    const onBreak = activeSessions.filter((s) => s.breaks.length > 0).length;
    const currentlyWorking = activeSessions.length - onBreak;

    // Missing checkout: sessions from yesterday that still have no checkout
    const yesterdayDate = new Date(todayDate.getTime() - 86400000);
    const missingCheckout = await this.prisma.attendanceSession.count({
      where: { day: { date: yesterdayDate }, checkOutAt: null },
    });

    // Order operations KPIs for this month.
    //
    // Delegated to OrderStaffPerformanceService so the dashboard and the
    // performance page can never disagree about what "confirmation rate" means.
    // It also dedupes per order: a raw OrderStaffEvent.count() would count one
    // order several times, once per status transition it went through.
    const monthStartStr = `${todayStr.slice(0, 8)}01`;
    const orderOpsRange = { from: monthStartStr, to: todayStr };
    const firstPage = await this.staffPerformance.getStaffPerformance({
      ...orderOpsRange,
      page: 1,
      perPage: 200,
    });

    // getStaffPerformance clamps perPage to 200 and aggregates the summary over
    // the employees on the returned page, so a larger workforce needs the
    // remaining pages walked too. The dashboard tile must reflect everyone.
    const orderOpsTotals = {
      totalOrdersHandled: firstPage.summary.totalOrdersHandled,
      totalConfirmed: firstPage.summary.totalConfirmed,
      totalDelivered: firstPage.summary.totalDelivered,
      totalReturned: firstPage.summary.totalReturned,
      totalCancelled: firstPage.summary.totalCancelled,
    };
    for (let page = 2; page <= firstPage.meta.totalPages; page++) {
      const next = await this.staffPerformance.getStaffPerformance({
        ...orderOpsRange,
        page,
        perPage: 200,
      });
      orderOpsTotals.totalOrdersHandled += next.summary.totalOrdersHandled;
      orderOpsTotals.totalConfirmed += next.summary.totalConfirmed;
      orderOpsTotals.totalDelivered += next.summary.totalDelivered;
      orderOpsTotals.totalReturned += next.summary.totalReturned;
      orderOpsTotals.totalCancelled += next.summary.totalCancelled;
    }

    const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
    const orderOps = {
      handled: orderOpsTotals.totalOrdersHandled,
      confirmed: orderOpsTotals.totalConfirmed,
      confirmationRate: pct(orderOpsTotals.totalConfirmed, orderOpsTotals.totalOrdersHandled),
      delivered: orderOpsTotals.totalDelivered,
      deliveryRateFromConfirmed: pct(orderOpsTotals.totalDelivered, orderOpsTotals.totalConfirmed),
      endToEndDeliveryRate: pct(orderOpsTotals.totalDelivered, orderOpsTotals.totalOrdersHandled),
      returned: orderOpsTotals.totalReturned,
      returnRate: pct(orderOpsTotals.totalReturned, orderOpsTotals.totalDelivered),
      cancelled: orderOpsTotals.totalCancelled,
      cancellationRate: pct(orderOpsTotals.totalCancelled, orderOpsTotals.totalOrdersHandled),
    };

    return {
      employees: {
        total,
        active: byStatus('active'),
        inactive: byStatus('inactive'),
        on_leave: byStatus('on_leave'),
        suspended: byStatus('suspended'),
        terminated: byStatus('terminated'),
        resigned: byStatus('resigned'),
      },
      ...(includePayroll
        ? {
            payroll: {
              lastPeriodKey,
              lastPeriodNet,
              pendingApprovals,
              paidThisMonth: toNumber(paidThisMonth._sum.netPay),
              payable: toNumber(payable._sum.netPay),
            },
            recentPayments: recentPayments.map((p) => ({
              id: p.id,
              employeeId: p.employee.employeeId,
              employeeName: p.employee.betterAuthUser?.name ?? 'Unknown',
              netPay: toNumber(p.netPay),
              paidAt: p.paidAt,
              periodKey: p.periodKey,
            })),
          }
        : {}),
      queues: {
        pendingLeaveRequests: pendingLeaves,
      },
      commissionThisMonth: 0,
      // ── New KPI sections ───────────────────────────────────────────────────
      attendance: {
        date: todayStr,
        total: attTotal,
        present: (attCounts['PRESENT'] ?? 0) + (attCounts['LATE'] ?? 0) + (attCounts['HALF_DAY'] ?? 0),
        absent: attCounts['ABSENT'] ?? 0,
        onLeave: attCounts['ON_LEAVE'] ?? 0,
        weeklyOff: attCounts['WEEKLY_OFF'] ?? 0,
        late: attCounts['LATE'] ?? 0,
        currentlyWorking,
        onBreak,
        missingCheckout,
        workedMinutes: attendanceTotals._sum.workedMinutes ?? 0,
        breakMinutes: attendanceTotals._sum.breakMinutes ?? 0,
        overtimeMinutes: attendanceTotals._sum.overtimeMinutes ?? 0,
      },
      tasks: {
        createdToday: tasksCreatedToday,
        completedToday: tasksCompletedToday,
        pendingTotal: tasksPending,
        completionRateToday: tasksCreatedToday > 0
          ? Math.round((tasksCompletedToday / tasksCreatedToday) * 1000) / 10
          : 0,
      },
      orderOperations: {
        periodLabel: 'This Month',
        ...orderOps,
      },
      exceptions: {
        missingCheckout,
        pendingLeaveRequests: pendingLeaves,
        overdueTasksTotal: await this.prisma.task.count({
          where: {
            status: { notIn: ['done', 'canceled'] },
            dueDate: { lt: now },
          },
        }),
      },
    };
  }
}