import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { HrLedgersService } from '../hr-ledgers/hr-ledgers.service';
import { CommissionsService } from '../commissions/commissions.service';
import { HrLeaveService } from '../hr-leave/hr-leave.service';
import { HrScheduleService } from '../hr-schedule/hr-schedule.service';
import { HrAttendanceService } from '../hr-attendance/hr-attendance.service';
import {
  parseLocalDate,
  dhakaToday,
} from '../hr-attendance/attendance-date';
import { CreateSelfLeaveRequestDto } from './dto/create-self-leave-request.dto';

interface SelfUser {
  betterAuthUserId?: string | null;
  userId?: string;
  id?: string;
}

@Injectable()
export class HrSelfServiceService {
  constructor(
    private prisma: PrismaService,
    private payroll: PayrollService,
    private ledgers: HrLedgersService,
    private commissions: CommissionsService,
    private leave: HrLeaveService,
    private schedule: HrScheduleService,
    private attendance: HrAttendanceService,
  ) {}

  /**
   * Resolve the Employee linked to the authenticated session user.
   * employeeId is ALWAYS derived from the session (betterAuthUserId) — never
   * from a client-supplied value. Returns 404 when no Employee is linked.
   */
  async resolveEmployee(user: SelfUser) {
    const linkId = user?.betterAuthUserId;
    if (!linkId) {
      throw new NotFoundException('No employee record is linked to this account');
    }
    const employee = await this.prisma.employee.findFirst({
      where: { betterAuthUserId: linkId },
      include: {
        department: true,
        designation: true,
        betterAuthUser: { select: { name: true, email: true, image: true } },
        reportingTo: {
          select: {
            employeeId: true,
            betterAuthUser: { select: { name: true } },
          },
        },
        salaryStructures: { where: { isActive: true }, take: 1 },
        bankAccounts: true,
        weeklyOffs: { where: { effectiveTo: null } },
        reports: {
          select: {
            id: true,
            employeeId: true,
            status: true,
            designation: { select: { name: true } },
            betterAuthUser: { select: { name: true, email: true } },
          },
        },
      },
    });
    if (!employee) {
      throw new NotFoundException('No employee record is linked to this account');
    }
    return employee;
  }

  async getProfile(user: SelfUser) {
    const employee = await this.resolveEmployee(user);
    const linkId = employee.betterAuthUserId;
    const userProfile = linkId
      ? await this.prisma.userProfile.findFirst({
          where: { betterAuthUserId: linkId },
          select: { id: true, username: true, phoneNumber: true },
        })
      : null;
    return {
      ...employee,
      userProfile,
    };
  }

  async getPerformance(user: SelfUser) {
    const employee = await this.resolveEmployee(user);
    const linkId = employee.betterAuthUserId;
    const userProfile = linkId
      ? await this.prisma.userProfile.findFirst({
          where: { betterAuthUserId: linkId },
          select: { id: true, username: true },
        })
      : null;

    const userId = userProfile?.id;

    // 1. Orders handled
    let totalAssignedOrders = 0;
    let deliveredOrders = 0;
    let processingOrders = 0;
    let cancelledOrders = 0;
    let totalDeliveredAmount = 0;
    let recentOrders: any[] = [];

    if (userId) {
      const orders = await this.prisma.order.findMany({
        where: { assignedToId: userId, trashedAt: null },
        include: {
          status: { select: { id: true, name: true, color: true } },
          customer: { select: { name: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      totalAssignedOrders = orders.length;
      for (const ord of orders) {
        const statusName = (ord.status?.name || '').toLowerCase();
        const amt = Number(ord.total || 0);
        if (statusName.includes('deliver')) {
          deliveredOrders++;
          totalDeliveredAmount += amt;
        } else if (
          statusName.includes('cancel') ||
          statusName.includes('fail') ||
          statusName.includes('return')
        ) {
          cancelledOrders++;
        } else {
          processingOrders++;
        }
      }

      recentOrders = orders.slice(0, 10).map((o) => ({
        id: o.id,
        displayId: o.displayId,
        customerName: o.customer?.name || o.guestName || 'Customer',
        customerPhone: o.customer?.phone || o.guestPhone || '',
        total: Number(o.total || 0),
        status: o.status?.name || 'Pending',
        statusColor: o.status?.color || '#6B7280',
        createdAt: o.createdAt,
      }));
    }

    // 2. Leads
    let assignedLeads = 0;
    let convertedLeads = 0;
    if (userId) {
      assignedLeads = await this.prisma.checkoutLead.count({
        where: { assignedToId: userId },
      });
      convertedLeads = await this.prisma.checkoutLead.count({
        where: { convertedById: userId },
      });
    }
    const conversionRate =
      assignedLeads > 0 ? Math.round((convertedLeads / assignedLeads) * 100) : 0;

    // 3. Tasks
    let totalTasks = 0;
    let completedTasks = 0;
    let pendingTasks = 0;
    let recentTasks: any[] = [];
    if (userProfile) {
      const tasks = await this.prisma.task.findMany({
        where: {
          OR: [
            { assignee: userProfile.username },
            { assignee: userProfile.id },
            { createdById: userProfile.id },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      totalTasks = tasks.length;
      for (const t of tasks) {
        if (t.status === 'done') {
          completedTasks++;
        } else {
          pendingTasks++;
        }
      }
      recentTasks = tasks.map((t) => ({
        id: t.id,
        displayId: t.displayId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        createdAt: t.createdAt,
      }));
    }

    // 4. Attendance (Current Month)
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const attendanceDays = await this.prisma.attendanceDay.findMany({
      where: {
        employeeId: employee.id,
        date: { gte: startOfMonth },
      },
    });

    let presentDays = 0;
    let lateDays = 0;
    let halfDays = 0;
    let absentDays = 0;
    let totalWorkedMinutes = 0;

    for (const d of attendanceDays) {
      if (d.status === 'PRESENT') presentDays++;
      else if (d.status === 'LATE') lateDays++;
      else if (d.status === 'HALF_DAY') halfDays++;
      else if (d.status === 'ABSENT') absentDays++;
      totalWorkedMinutes += d.workedMinutes || 0;
    }
    const onTimeRate =
      presentDays + lateDays > 0
        ? Math.round((presentDays / (presentDays + lateDays)) * 100)
        : 100;

    // 5. Financial / Commissions / Bonuses
    const commissions = await this.prisma.commissionEarning.findMany({
      where: { employeeId: employee.id, status: { in: ['approved', 'paid'] } },
      select: { amount: true, createdAt: true },
    });
    let totalCommission = 0;
    let monthCommission = 0;
    for (const c of commissions) {
      const amt = Number(c.amount || 0);
      totalCommission += amt;
      if (new Date(c.createdAt) >= startOfMonth) {
        monthCommission += amt;
      }
    }

    const earnings = await this.prisma.employeeEarning.findMany({
      where: { employeeId: employee.id, status: { in: ['approved', 'paid'] } },
      select: { amount: true },
    });
    const totalBonuses = earnings.reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0,
    );

    const latestPayslip = await this.prisma.payslip.findFirst({
      where: { employeeId: employee.id },
      orderBy: { periodStart: 'desc' },
      select: { periodKey: true, netPay: true, status: true, paidAt: true },
    });

    // 6. Leaves summary
    const leaveBalances = await this.leave.leaveBalances(employee.id);
    const pendingLeaveCount = await this.prisma.leaveRequest.count({
      where: { employeeId: employee.id, status: 'pending' },
    });
    const totalRemainingLeave = leaveBalances.reduce(
      (sum, b) => sum + (b.remaining || 0),
      0,
    );

    return {
      orders: {
        totalAssignedOrders,
        deliveredOrders,
        processingOrders,
        cancelledOrders,
        totalDeliveredAmount,
        deliveryRate:
          totalAssignedOrders > 0
            ? Math.round((deliveredOrders / totalAssignedOrders) * 100)
            : 0,
        recentOrders,
      },
      leads: {
        assignedLeads,
        convertedLeads,
        conversionRate,
      },
      tasks: {
        totalTasks,
        completedTasks,
        pendingTasks,
        completionRate:
          totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        recentTasks,
      },
      attendance: {
        presentDays,
        lateDays,
        halfDays,
        absentDays,
        totalWorkedMinutes,
        workedHours: Math.round((totalWorkedMinutes / 60) * 10) / 10,
        onTimeRate,
      },
      financial: {
        baseSalary: Number(employee.salary || 0),
        totalCommission,
        monthCommission,
        totalBonuses,
        latestPayslip: latestPayslip
          ? {
              periodKey: latestPayslip.periodKey,
              netPay: Number(latestPayslip.netPay || 0),
              status: latestPayslip.status,
              paidAt: latestPayslip.paidAt,
            }
          : null,
      },
      leaves: {
        totalRemaining: totalRemainingLeave,
        pendingCount: pendingLeaveCount,
        balances: leaveBalances,
      },
    };
  }

  async getSalary(user: SelfUser) {
    const employee = await this.resolveEmployee(user);
    return this.payroll.getSalaryStructure(employee.id);
  }

  async getPayslips(user: SelfUser, page = 1, perPage = 20) {
    const employee = await this.resolveEmployee(user);
    return this.payroll.findAllPayslips(page, perPage, undefined, employee.id);
  }

  async getPayslipPayments(user: SelfUser, payslipId: string) {
    const employee = await this.resolveEmployee(user);
    const payslip = await this.payroll.findPayslip(payslipId);
    if (payslip.employeeId !== employee.id) {
      throw new NotFoundException('Payslip not found');
    }
    return this.payroll.getPayments(payslipId);
  }

  /**
   * Full payslip statement for self-service.
   *
   * The admin "View payslip" dialog needs the payslip plus its line items, but
   * it was pointed at GET /payroll/payslips/:id, which is gated to
   * superadmin/admin/manager. A plain `employee` clicking View therefore got a
   * 403 — the list and net-pay figures rendered (they use /hr/my/payslips) but
   * the drill-down failed. getPayslipPayments could not serve this either: it
   * returns only payrollPayment rows, with none of the payslip's earnings and
   * deduction lines.
   *
   * Ownership is checked here so a user can only ever read their own payslip.
   */
  async getPayslip(user: SelfUser, payslipId: string) {
    const employee = await this.resolveEmployee(user);
    const payslip = await this.payroll.findPayslip(payslipId);
    if (payslip.employeeId !== employee.id) {
      // 404 rather than 403: a payslip that exists but belongs to someone else
      // must not be distinguishable from one that does not exist.
      throw new NotFoundException('Payslip not found');
    }
    return payslip;
  }

  async getCommissions(user: SelfUser, page = 1, perPage = 20) {
    const employee = await this.resolveEmployee(user);
    return this.commissions.listEarnings({ employeeId: employee.id }, page, perPage);
  }

  async getEarnings(user: SelfUser, page = 1, perPage = 20) {
    const employee = await this.resolveEmployee(user);
    return this.ledgers.findEarnings({ employeeId: employee.id }, page, perPage);
  }

  async getDeductions(user: SelfUser, page = 1, perPage = 20) {
    const employee = await this.resolveEmployee(user);
    return this.ledgers.findDeductions({ employeeId: employee.id }, page, perPage);
  }

  async getSchedule(user: SelfUser) {
    const employee = await this.resolveEmployee(user);
    return this.schedule.getSchedule(employee.id);
  }

  async getLeaveTypes(user: SelfUser) {
    await this.resolveEmployee(user);
    return this.leave.listTypes({ isActive: true });
  }

  async getLeaveBalances(user: SelfUser) {
    const employee = await this.resolveEmployee(user);
    return this.leave.leaveBalances(employee.id);
  }

  async getLeaveRequests(user: SelfUser, page = 1, perPage = 20) {
    const employee = await this.resolveEmployee(user);
    return this.leave.listRequests({ employeeId: employee.id }, page, perPage);
  }

  async createLeaveRequest(user: SelfUser, dto: CreateSelfLeaveRequestDto) {
    const employee = await this.resolveEmployee(user);
    const actorId = user?.userId ?? user?.id;
    return this.leave.createRequest(
      {
        employeeId: employee.id,
        typeId: dto.typeId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        days: dto.days,
        reason: dto.reason,
      },
      actorId,
    );
  }

  async cancelLeaveRequest(user: SelfUser, id: string) {
    const employee = await this.resolveEmployee(user);
    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request || request.employeeId !== employee.id) {
      throw new NotFoundException('Leave request not found');
    }
    const actorId = user?.userId ?? user?.id;
    return this.leave.cancelRequest(id, actorId);
  }

  async getAttendance(user: SelfUser, from?: string, to?: string) {
    const employee = await this.resolveEmployee(user);
    return this.attendance.history(employee.id, from, to);
  }

  async getTodayAttendance(user: SelfUser, date?: string) {
    const employee = await this.resolveEmployee(user);
    return this.attendance.getDayState(employee.id, date);
  }

  /**
   * Self-service clock actions are server-authoritative on the Dhaka business
   * date. If the client insists on a date, it must equal today.
   */
  private assertTodayOnly(date?: string) {
    if (!date) return;
    const given = parseLocalDate(date).getTime();
    const today = parseLocalDate(dhakaToday()).getTime();
    if (given !== today) {
      throw new BadRequestException('Can only check in for today.');
    }
  }

  async checkInSelf(user: SelfUser, note?: string, date?: string) {
    const employee = await this.resolveEmployee(user);
    this.assertTodayOnly(date);
    return this.attendance.checkIn(employee.id, { note, date });
  }

  async breakStartSelf(user: SelfUser, date?: string) {
    const employee = await this.resolveEmployee(user);
    this.assertTodayOnly(date);
    return this.attendance.breakStart(employee.id, { date });
  }

  async breakEndSelf(user: SelfUser, date?: string) {
    const employee = await this.resolveEmployee(user);
    this.assertTodayOnly(date);
    return this.attendance.breakEnd(employee.id, { date });
  }

  async checkOutSelf(user: SelfUser, note?: string, date?: string) {
    const employee = await this.resolveEmployee(user);
    this.assertTodayOnly(date);
    return this.attendance.checkOut(employee.id, { note, date });
  }

  async getAttendanceReport(user: SelfUser, from?: string, to?: string) {
    const employee = await this.resolveEmployee(user);
    return this.attendance.report(employee.id, from, to);
  }
}
