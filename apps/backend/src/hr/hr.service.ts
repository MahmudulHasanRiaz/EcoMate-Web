import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dhakaToday, dhakaStartOfDay } from '../hr-attendance/attendance-date';

const toNumber = (value: { toString(): string } | null | undefined): number =>
  value ? Number(value) : 0;

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
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

    // Order operations KPIs for this month (from OrderStaffEvent if available)
    const orderOpsStartDate = monthStart;
    const orderHandled = await this.prisma.orderStaffEvent.count({
      where: {
        action: 'ASSIGNED',
        createdAt: { gte: orderOpsStartDate },
      },
    }).catch(() => 0);

    const confirmedThisMonth = await this.prisma.orderStaffEvent.count({
      where: {
        action: 'STATUS_CHANGED',
        toStatus: 'Confirmed',
        createdAt: { gte: orderOpsStartDate },
      },
    }).catch(() => 0);

    const deliveredThisMonth = await this.prisma.orderStaffEvent.count({
      where: {
        action: 'STATUS_CHANGED',
        toStatus: 'Delivered',
        createdAt: { gte: orderOpsStartDate },
      },
    }).catch(() => 0);

    const cancelledThisMonth = await this.prisma.orderStaffEvent.count({
      where: {
        action: 'STATUS_CHANGED',
        toStatus: 'Cancelled',
        createdAt: { gte: orderOpsStartDate },
      },
    }).catch(() => 0);

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
        handled: orderHandled,
        confirmed: confirmedThisMonth,
        confirmationRate: orderHandled > 0 ? Math.round((confirmedThisMonth / orderHandled) * 1000) / 10 : 0,
        delivered: deliveredThisMonth,
        deliveryRateFromConfirmed: confirmedThisMonth > 0
          ? Math.round((deliveredThisMonth / confirmedThisMonth) * 1000) / 10 : 0,
        cancelled: cancelledThisMonth,
        cancellationRate: orderHandled > 0 ? Math.round((cancelledThisMonth / orderHandled) * 1000) / 10 : 0,
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