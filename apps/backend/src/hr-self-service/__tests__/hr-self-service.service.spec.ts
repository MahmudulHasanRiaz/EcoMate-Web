import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HrSelfServiceService } from '../hr-self-service.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollService } from '../../payroll/payroll.service';
import { HrLedgersService } from '../../hr-ledgers/hr-ledgers.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { HrLeaveService } from '../../hr-leave/hr-leave.service';
import { HrScheduleService } from '../../hr-schedule/hr-schedule.service';
import { HrAttendanceService } from '../../hr-attendance/hr-attendance.service';

const SESSION_USER = { betterAuthUserId: 'ba-1', userId: 'user-1' };
const OTHER_USER = { betterAuthUserId: 'ba-2', userId: 'user-2' };
const RESOLVED_EMP = {
  id: 'emp-1',
  employeeId: 'EMP-260823-0001',
  betterAuthUserId: 'ba-1',
};

describe('HrSelfServiceService', () => {
  let service: HrSelfServiceService;
  let prisma: PrismaService;
  let payroll: PayrollService;
  let ledgers: HrLedgersService;
  let commissions: CommissionsService;
  let leave: HrLeaveService;
  let schedule: HrScheduleService;
  let attendance: HrAttendanceService;

  const prismaMock = {
    employee: { findFirst: jest.fn() },
    userProfile: { findFirst: jest.fn() },
    order: { findMany: jest.fn() },
    checkoutLead: { count: jest.fn() },
    task: { findMany: jest.fn() },
    attendanceDay: { findMany: jest.fn() },
    commissionEarning: { findMany: jest.fn() },
    employeeEarning: { findMany: jest.fn() },
    payslip: { findFirst: jest.fn() },
    leaveRequest: { findUnique: jest.fn(), count: jest.fn() },
  };

  const payrollMock = {
    getSalaryStructure: jest.fn(),
    findAllPayslips: jest.fn(),
    findPayslip: jest.fn(),
    getPayments: jest.fn(),
  };
  const ledgersMock = {
    findEarnings: jest.fn(),
    findDeductions: jest.fn(),
  };
  const commissionsMock = { listEarnings: jest.fn() };
  const leaveMock = {
    listRequests: jest.fn(),
    createRequest: jest.fn(),
    cancelRequest: jest.fn(),
    leaveBalances: jest.fn(),
  };
  const scheduleMock = { getSchedule: jest.fn() };
  const attendanceMock = {
    history: jest.fn(),
    checkIn: jest.fn(),
    breakStart: jest.fn(),
    breakEnd: jest.fn(),
    checkOut: jest.fn(),
    getDayState: jest.fn(),
    report: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrSelfServiceService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PayrollService, useValue: payrollMock },
        { provide: HrLedgersService, useValue: ledgersMock },
        { provide: CommissionsService, useValue: commissionsMock },
        { provide: HrLeaveService, useValue: leaveMock },
        { provide: HrScheduleService, useValue: scheduleMock },
        { provide: HrAttendanceService, useValue: attendanceMock },
      ],
    }).compile();

    service = module.get(HrSelfServiceService);
    prisma = module.get(PrismaService);
    payroll = module.get(PayrollService);
    ledgers = module.get(HrLedgersService);
    commissions = module.get(CommissionsService);
    leave = module.get(HrLeaveService);
    schedule = module.get(HrScheduleService);
    attendance = module.get(HrAttendanceService);

    jest.clearAllMocks();
    prismaMock.employee.findFirst.mockResolvedValue(RESOLVED_EMP);
  });

  describe('resolveEmployee', () => {
    it('returns 404 when no Employee is linked to the session user', async () => {
      prismaMock.employee.findFirst.mockResolvedValue(null);
      await expect(service.getProfile(SESSION_USER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 404 when the session has no betterAuthUserId', async () => {
      await expect(service.getProfile({ userId: 'x' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('resolves by betterAuthUserId and returns the employee', async () => {
      const result = await service.getProfile(SESSION_USER);
      expect(prismaMock.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { betterAuthUserId: 'ba-1' },
        }),
      );
      expect(result).toEqual({ ...RESOLVED_EMP, userProfile: undefined });
    });
  });

  describe('dual-role My HR (G-10)', () => {
    const MANAGER_session = {
      betterAuthUserId: 'ba-mgr',
      userId: 'mgr-1',
      role: 'employee',
    };

    it('returns the manager their own profile when an Employee record is linked', async () => {
      const managerEmp = { ...RESOLVED_EMP, id: 'emp-mgr' };
      prismaMock.employee.findFirst.mockResolvedValue(managerEmp);
      const result = await service.getProfile(MANAGER_session);
      expect(prismaMock.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { betterAuthUserId: 'ba-mgr' } }),
      );
      expect(result).toEqual({ ...managerEmp, userProfile: undefined });
    });

    it('staff with no Employee record get 404 on self-service (resolveEmployee) — not their data', async () => {
      prismaMock.employee.findFirst.mockResolvedValue(null);
      await expect(service.getProfile(MANAGER_session)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getLeaveBalances returns only the resolved employee balances', async () => {
      leaveMock.leaveBalances.mockResolvedValue([
        { typeName: 'Casual Leave', entitlement: 10, used: 2, remaining: 8 },
      ]);
      const res = await service.getLeaveBalances(SESSION_USER);
      expect(leaveMock.leaveBalances).toHaveBeenCalledWith('emp-1');
      expect(res).toEqual([
        { typeName: 'Casual Leave', entitlement: 10, used: 2, remaining: 8 },
      ]);
    });

    it('getLeaveBalances 404s when no Employee record is linked', async () => {
      prismaMock.employee.findFirst.mockResolvedValue(null);
      await expect(service.getLeaveBalances(SESSION_USER)).rejects.toThrow(
        NotFoundException,
      );
      expect(leaveMock.leaveBalances).not.toHaveBeenCalled();
    });
  });

  describe('scoped reads use the resolved employee id only', () => {
    it('getSalary uses resolved id', async () => {
      payrollMock.getSalaryStructure.mockResolvedValue({ id: 'ss-1' });
      await service.getSalary(SESSION_USER);
      expect(payrollMock.getSalaryStructure).toHaveBeenCalledWith('emp-1');
    });

    it('getPayslips passes resolved employeeId (never a client id)', async () => {
      payrollMock.findAllPayslips.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      });
      await service.getPayslips(SESSION_USER, 2, 10);
      expect(payrollMock.findAllPayslips).toHaveBeenCalledWith(
        2,
        10,
        undefined,
        'emp-1',
      );
    });

    it('getPayslipPayments 404s for a payslip owned by another employee', async () => {
      payrollMock.findPayslip.mockResolvedValue({ employeeId: 'emp-other' });
      await expect(
        service.getPayslipPayments(SESSION_USER, 'ps-1'),
      ).rejects.toThrow(NotFoundException);
      expect(payrollMock.getPayments).not.toHaveBeenCalled();
    });

    it('getPayslipPayments returns payments for own payslip', async () => {
      payrollMock.findPayslip.mockResolvedValue({ employeeId: 'emp-1' });
      payrollMock.getPayments.mockResolvedValue([{ id: 'pp-1' }]);
      const res = await service.getPayslipPayments(SESSION_USER, 'ps-1');
      expect(res).toEqual([{ id: 'pp-1' }]);
      expect(payrollMock.getPayments).toHaveBeenCalledWith('ps-1');
    });

    it('getCommissions passes resolved employeeId', async () => {
      commissionsMock.listEarnings.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      });
      await service.getCommissions(SESSION_USER, 1, 20);
      expect(commissionsMock.listEarnings).toHaveBeenCalledWith(
        { employeeId: 'emp-1' },
        1,
        20,
      );
    });

    it('getEarnings passes resolved employeeId', async () => {
      ledgersMock.findEarnings.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      });
      await service.getEarnings(SESSION_USER);
      expect(ledgersMock.findEarnings).toHaveBeenCalledWith(
        { employeeId: 'emp-1' },
        1,
        20,
      );
    });

    it('getDeductions passes resolved employeeId', async () => {
      ledgersMock.findDeductions.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      });
      await service.getDeductions(SESSION_USER);
      expect(ledgersMock.findDeductions).toHaveBeenCalledWith(
        { employeeId: 'emp-1' },
        1,
        20,
      );
    });

    it('getSchedule passes resolved employeeId', async () => {
      scheduleMock.getSchedule.mockResolvedValue({ days: [] });
      await service.getSchedule(SESSION_USER);
      expect(scheduleMock.getSchedule).toHaveBeenCalledWith('emp-1');
    });

    it('getLeaveRequests passes resolved employeeId', async () => {
      leaveMock.listRequests.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      });
      await service.getLeaveRequests(SESSION_USER);
      expect(leaveMock.listRequests).toHaveBeenCalledWith(
        { employeeId: 'emp-1' },
        1,
        20,
      );
    });

    it('getAttendance returns only the resolved employee records, ignoring any client-supplied employeeId', async () => {
      attendanceMock.history.mockResolvedValue([
        { id: 'att-1', employeeId: 'emp-1', status: 'PRESENT' },
        { id: 'att-2', employeeId: 'emp-1', status: 'LATE' },
      ]);
      const res = await service.getAttendance(
        SESSION_USER,
        undefined as any,
        '2026-08-31',
      );
      expect(attendanceMock.history).toHaveBeenCalledWith(
        'emp-1',
        undefined,
        '2026-08-31',
      );
      expect(res).toEqual([
        { id: 'att-1', employeeId: 'emp-1', status: 'PRESENT' },
        { id: 'att-2', employeeId: 'emp-1', status: 'LATE' },
      ]);
      const fromArg = attendanceMock.history.mock.calls[0][0];
      expect(fromArg).toBe('emp-1');
      expect(fromArg).not.toBe('emp-evil');
    });

    it('getAttendance 404s when the session employee is unlinked', async () => {
      prismaMock.employee.findFirst.mockResolvedValue(null);
      await expect(service.getAttendance(SESSION_USER)).rejects.toThrow(
        NotFoundException,
      );
      expect(attendanceMock.history).not.toHaveBeenCalled();
    });
  });

  describe('self attendance state machine (employeeId never client-supplied)', () => {
    const evil = { employeeId: 'evil-emp' } as any;

    it('checkInSelf uses the resolved employee and passes the note through (server dates today)', async () => {
      attendanceMock.checkIn.mockResolvedValue({ id: 's-1' });
      const res = await service.checkInSelf(SESSION_USER, 'on time');
      expect(attendanceMock.checkIn).toHaveBeenCalledWith('emp-1', {
        note: 'on time',
        date: undefined,
      });
      const args = attendanceMock.checkIn.mock.calls[0];
      expect(args[0]).toBe('emp-1');
      expect(args[0]).not.toBe(evil.employeeId);
      expect(res).toEqual({ id: 's-1' });
    });

    it('rejects a self-service check-in date that is not today (400)', async () => {
      await expect(
        service.checkInSelf(SESSION_USER, 'x', '2020-01-01'),
      ).rejects.toThrow(BadRequestException);
      expect(attendanceMock.checkIn).not.toHaveBeenCalled();
    });

    it('breakStartSelf / breakEndSelf pass the resolved employee (server dates today)', async () => {
      await service.breakStartSelf(SESSION_USER, undefined);
      expect(attendanceMock.breakStart).toHaveBeenCalledWith('emp-1', {
        date: undefined,
      });
      await service.breakEndSelf(SESSION_USER, undefined);
      expect(attendanceMock.breakEnd).toHaveBeenCalledWith('emp-1', {
        date: undefined,
      });
    });

    it('rejects a self-service break date that is not today (400)', async () => {
      await expect(
        service.breakStartSelf(SESSION_USER, '2020-01-01'),
      ).rejects.toThrow(BadRequestException);
      expect(attendanceMock.breakStart).not.toHaveBeenCalled();
    });

    it('checkOutSelf passes resolved employee + note (server dates today)', async () => {
      await service.checkOutSelf(SESSION_USER, 'wrap up');
      expect(attendanceMock.checkOut).toHaveBeenCalledWith('emp-1', {
        note: 'wrap up',
        date: undefined,
      });
      const args = attendanceMock.checkOut.mock.calls[0];
      expect(args[0]).toBe('emp-1');
      expect(args[0]).not.toBe(evil.employeeId);
    });

    it('getTodayAttendance scopes the state to the resolved employee only', async () => {
      attendanceMock.getDayState.mockResolvedValue({ state: 'working' });
      const res = await service.getTodayAttendance(SESSION_USER, '2026-08-28');
      expect(attendanceMock.getDayState).toHaveBeenCalledWith('emp-1', '2026-08-28');
      expect(res).toEqual({ state: 'working' });
    });

    it('all self attendance calls 404 when the session employee is unlinked', async () => {
      prismaMock.employee.findFirst.mockResolvedValue(null);
      await expect(service.checkInSelf(SESSION_USER, 'x', '2026-08-28')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.checkOutSelf(OTHER_USER, 'x', '2026-08-28')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getTodayAttendance(OTHER_USER, '2026-08-28')).rejects.toThrow(
        NotFoundException,
      );
      expect(attendanceMock.checkIn).not.toHaveBeenCalled();
      expect(attendanceMock.checkOut).not.toHaveBeenCalled();
      expect(attendanceMock.getDayState).not.toHaveBeenCalled();
    });
  });

  describe('attendance report (G-18)', () => {
    it('delegates the resolved employee + range to the shared attendance report', async () => {
      attendanceMock.report.mockResolvedValue({
        employeeId: 'emp-1',
        daysInRange: 9,
        present: 5,
      });
      const res = await service.getAttendanceReport(
        SESSION_USER,
        '2026-08-01',
        '2026-08-09',
      );
      expect(attendanceMock.report).toHaveBeenCalledWith(
        'emp-1',
        '2026-08-01',
        '2026-08-09',
      );
      // never a client-supplied employee id
      const args = attendanceMock.report.mock.calls[0];
      expect(args[0]).toBe('emp-1');
      expect(res).toEqual({
        employeeId: 'emp-1',
        daysInRange: 9,
        present: 5,
      });
    });

    it('404s when the session employee is unlinked', async () => {
      prismaMock.employee.findFirst.mockResolvedValue(null);
      await expect(service.getAttendanceReport(OTHER_USER)).rejects.toThrow(
        NotFoundException,
      );
      expect(attendanceMock.report).not.toHaveBeenCalled();
    });
  });

  describe('leave request writes', () => {
    const dto = {
      typeId: 'type-1',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      reason: 'vacation',
      employeeId: 'evil-emp', // must be ignored
    } as any;

    it('createLeaveRequest ignores client employeeId and uses resolved id', async () => {
      leaveMock.createRequest.mockResolvedValue({ id: 'lr-1' });
      await service.createLeaveRequest(SESSION_USER, dto);
      expect(leaveMock.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({ employeeId: 'emp-1', typeId: 'type-1' }),
        'user-1',
      );
      const captured = leaveMock.createRequest.mock.calls[0][0];
      expect(captured.employeeId).toBe('emp-1');
      expect(captured.employeeId).not.toBe('evil-emp');
    });

    it('cancelLeaveRequest returns 404 when request belongs to another employee', async () => {
      prismaMock.leaveRequest.findUnique.mockResolvedValue({
        id: 'lr-1',
        employeeId: 'emp-other',
      });
      await expect(
        service.cancelLeaveRequest(SESSION_USER, 'lr-1'),
      ).rejects.toThrow(NotFoundException);
      expect(leaveMock.cancelRequest).not.toHaveBeenCalled();
    });

    it('cancelLeaveRequest returns 404 when request does not exist', async () => {
      prismaMock.leaveRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.cancelLeaveRequest(SESSION_USER, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('cancelLeaveRequest cancels own request', async () => {
      prismaMock.leaveRequest.findUnique.mockResolvedValue({
        id: 'lr-1',
        employeeId: 'emp-1',
      });
      leaveMock.cancelRequest.mockResolvedValue({ id: 'lr-1', status: 'cancelled' });
      await service.cancelLeaveRequest(SESSION_USER, 'lr-1');
      expect(leaveMock.cancelRequest).toHaveBeenCalledWith('lr-1', 'user-1');
    });
  });

  describe('getPerformance', () => {
    it('aggregates orders, leads, tasks, attendance, financial, and leaves metrics', async () => {
      prismaMock.userProfile.findFirst.mockResolvedValue({
        id: 'u-1',
        username: 'john',
      });
      prismaMock.order.findMany.mockResolvedValue([
        {
          id: 'ord-1',
          displayId: 'ORD-001',
          total: 1500,
          createdAt: new Date(),
          status: { id: 's-1', name: 'Delivered', color: '#10B981' },
          customer: { name: 'Customer One', phoneNumber: '01711111111' },
        },
        {
          id: 'ord-2',
          displayId: 'ORD-002',
          total: 2000,
          createdAt: new Date(),
          status: { id: 's-2', name: 'Processing', color: '#3B82F6' },
          guestName: 'Guest Two',
          guestPhone: '01822222222',
        },
      ]);
      prismaMock.checkoutLead.count
        .mockResolvedValueOnce(10) // assigned
        .mockResolvedValueOnce(6); // converted
      prismaMock.task.findMany.mockResolvedValue([
        {
          id: 't-1',
          displayId: 'TSK-1',
          title: 'Review invoice',
          status: 'done',
          priority: 'high',
          dueDate: null,
          createdAt: new Date(),
        },
      ]);
      prismaMock.attendanceDay.findMany.mockResolvedValue([
        { status: 'PRESENT', workedMinutes: 480 },
        { status: 'LATE', workedMinutes: 450 },
      ]);
      prismaMock.commissionEarning.findMany.mockResolvedValue([
        { amount: 500, createdAt: new Date() },
      ]);
      prismaMock.employeeEarning.findMany.mockResolvedValue([{ amount: 1000 }]);
      prismaMock.payslip.findFirst.mockResolvedValue({
        periodKey: '2026-09',
        netPay: 45000,
        status: 'paid',
        paidAt: new Date(),
      });
      leaveMock.leaveBalances.mockResolvedValue([
        { typeName: 'Casual', remaining: 8 },
      ]);
      prismaMock.leaveRequest.count.mockResolvedValue(1);

      const perf = await service.getPerformance(SESSION_USER);

      expect(perf.orders.totalAssignedOrders).toBe(2);
      expect(perf.orders.deliveredOrders).toBe(1);
      expect(perf.orders.processingOrders).toBe(1);
      expect(perf.orders.totalDeliveredAmount).toBe(1500);
      expect(perf.orders.deliveryRate).toBe(50);
      expect(perf.leads.assignedLeads).toBe(10);
      expect(perf.leads.convertedLeads).toBe(6);
      expect(perf.leads.conversionRate).toBe(60);
      expect(perf.tasks.totalTasks).toBe(1);
      expect(perf.tasks.completedTasks).toBe(1);
      expect(perf.attendance.presentDays).toBe(1);
      expect(perf.attendance.lateDays).toBe(1);
      expect(perf.attendance.onTimeRate).toBe(50);
      expect(perf.financial.totalCommission).toBe(500);
      expect(perf.financial.totalBonuses).toBe(1000);
      expect(perf.financial.latestPayslip?.netPay).toBe(45000);
      expect(perf.leaves.totalRemaining).toBe(8);
      expect(perf.leaves.pendingCount).toBe(1);
    });

    it('handles employee with no userProfile or assigned data cleanly without crash', async () => {
      prismaMock.userProfile.findFirst.mockResolvedValue(null);
      prismaMock.attendanceDay.findMany.mockResolvedValue([]);
      prismaMock.commissionEarning.findMany.mockResolvedValue([]);
      prismaMock.employeeEarning.findMany.mockResolvedValue([]);
      prismaMock.payslip.findFirst.mockResolvedValue(null);
      leaveMock.leaveBalances.mockResolvedValue([]);
      prismaMock.leaveRequest.count.mockResolvedValue(0);

      const perf = await service.getPerformance(SESSION_USER);

      expect(perf.orders.totalAssignedOrders).toBe(0);
      expect(perf.leads.assignedLeads).toBe(0);
      expect(perf.tasks.totalTasks).toBe(0);
      expect(perf.attendance.presentDays).toBe(0);
      expect(perf.financial.totalCommission).toBe(0);
      expect(perf.financial.latestPayslip).toBeNull();
      expect(perf.leaves.totalRemaining).toBe(0);
    });
  });


  /**
   * Ownership enforcement for payslip reads.
   *
   * The admin self-service page opened payslips through GET
   * /payroll/payslips/:id, which is restricted to superadmin/admin/manager, so
   * a plain `employee` got a 403 the moment they opened their own payslip. The
   * replacement route must work for them AND must never become a way to read
   * someone else's payslip.
   */
  describe('payslip self-service access', () => {
    it('returns the caller\'s own payslip', async () => {
      const payslip = { id: 'ps-1', employeeId: RESOLVED_EMP.id, periodKey: '2026-09' };
      payrollMock.findPayslip.mockResolvedValue(payslip);

      await expect(service.getPayslip(SESSION_USER, 'ps-1')).resolves.toBe(payslip);
    });

    it('refuses a payslip belonging to another employee', async () => {
      payrollMock.findPayslip.mockResolvedValue({ id: 'ps-2', employeeId: 'emp-other' });

      await expect(service.getPayslip(SESSION_USER, 'ps-2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // 404 rather than 403: otherwise a user could probe which payslip ids
    // exist just by comparing error codes.
    it('does not reveal that another employee\'s payslip exists', async () => {
      payrollMock.findPayslip.mockResolvedValue({ id: 'ps-2', employeeId: 'emp-other' });
      const foreign = await service
        .getPayslip(SESSION_USER, 'ps-2')
        .catch((e: Error) => e.message);

      payrollMock.findPayslip.mockRejectedValue(new NotFoundException('Payslip not found'));
      const missing = await service
        .getPayslip(SESSION_USER, 'does-not-exist')
        .catch((e: Error) => e.message);

      expect(foreign).toBe(missing);
    });

    it('still guards the payments route', async () => {
      payrollMock.findPayslip.mockResolvedValue({ id: 'ps-2', employeeId: 'emp-other' });

      await expect(
        service.getPayslipPayments(SESSION_USER, 'ps-2'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(payrollMock.getPayments).not.toHaveBeenCalled();
    });
  });
});
