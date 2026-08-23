import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const toNumber = (value: { toString(): string } | null | undefined): number =>
  value ? Number(value) : 0;

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      employeeCounts,
      pendingApprovals,
      paidThisMonth,
      lastPeriodPayslip,
      payable,
      recentPayments,
    ] = await Promise.all([
      this.prisma.employee.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.payslip.count({
        where: { status: { in: ['draft', 'reviewed'] } },
      }),
      this.prisma.payslip.aggregate({
        where: { status: 'paid', paidAt: { gte: monthStart } },
        _sum: { netPay: true },
      }),
      this.prisma.payslip.findFirst({
        where: {
          status: { in: ['paid', 'approved'] },
          periodKey: { not: null },
        },
        orderBy: { periodStart: 'desc' },
        select: { periodKey: true },
      }),
      this.prisma.payslip.aggregate({
        where: {
          status: { in: ['approved', 'partially_paid'] },
        },
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
    ]);

    const total = employeeCounts.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );
    const byStatus = (name: string) =>
      employeeCounts.find((row) => row.status === name)?._count._all ?? 0;

    let lastPeriodKey: string | null = null;
    let lastPeriodNet = 0;
    if (lastPeriodPayslip?.periodKey) {
      lastPeriodKey = lastPeriodPayslip.periodKey;
      const lastPeriodSum = await this.prisma.payslip.aggregate({
        where: {
          periodKey: lastPeriodKey,
          status: { in: ['paid', 'approved'] },
        },
        _sum: { netPay: true },
      });
      lastPeriodNet = toNumber(lastPeriodSum._sum.netPay);
    }

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
        pendingLeaveRequests: 0,
      },
      commissionThisMonth: 0,
    };
  }
}