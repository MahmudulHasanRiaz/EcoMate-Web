import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { HrLedgersService } from '../hr-ledgers/hr-ledgers.service';
import { CommissionsService } from '../commissions/commissions.service';
import { HrLeaveService } from '../hr-leave/hr-leave.service';
import { HrScheduleService } from '../hr-schedule/hr-schedule.service';
import { HrAttendanceService } from '../hr-attendance/hr-attendance.service';
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
        betterAuthUser: { select: { name: true, email: true } },
        reportingTo: {
          select: {
            employeeId: true,
            betterAuthUser: { select: { name: true } },
          },
        },
        salaryStructures: { where: { isActive: true }, take: 1 },
      },
    });
    if (!employee) {
      throw new NotFoundException('No employee record is linked to this account');
    }
    return employee;
  }

  getProfile(user: SelfUser) {
    return this.resolveEmployee(user);
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

  async checkInSelf(user: SelfUser, note?: string, date?: string) {
    const employee = await this.resolveEmployee(user);
    return this.attendance.checkIn(employee.id, { note, date });
  }

  async breakStartSelf(user: SelfUser, date?: string) {
    const employee = await this.resolveEmployee(user);
    return this.attendance.breakStart(employee.id, { date });
  }

  async breakEndSelf(user: SelfUser, date?: string) {
    const employee = await this.resolveEmployee(user);
    return this.attendance.breakEnd(employee.id, { date });
  }

  async checkOutSelf(user: SelfUser, note?: string, date?: string) {
    const employee = await this.resolveEmployee(user);
    return this.attendance.checkOut(employee.id, { note, date });
  }
}
