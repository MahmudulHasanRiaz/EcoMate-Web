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
    leaveRequest: { findUnique: jest.fn() },
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
      expect(result).toEqual(RESOLVED_EMP);
    });
  });

  describe('dual-role My HR (G-10)', () => {
    const MANAGER_session = {
      betterAuthUserId: 'ba-mgr',
      userId: 'mgr-1',
      role: 'manager',
    };

    it('returns the manager their own profile when an Employee record is linked', async () => {
      const managerEmp = { ...RESOLVED_EMP, id: 'emp-mgr' };
      prismaMock.employee.findFirst.mockResolvedValue(managerEmp);
      const result = await service.getProfile(MANAGER_session);
      expect(prismaMock.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { betterAuthUserId: 'ba-mgr' } }),
      );
      expect(result).toEqual(managerEmp);
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
});
