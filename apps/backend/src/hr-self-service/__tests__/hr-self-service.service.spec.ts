import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HrSelfServiceService } from '../hr-self-service.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollService } from '../../payroll/payroll.service';
import { HrLedgersService } from '../../hr-ledgers/hr-ledgers.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { HrLeaveService } from '../../hr-leave/hr-leave.service';
import { HrScheduleService } from '../../hr-schedule/hr-schedule.service';

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
  };
  const scheduleMock = { getSchedule: jest.fn() };

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
      ],
    }).compile();

    service = module.get(HrSelfServiceService);
    prisma = module.get(PrismaService);
    payroll = module.get(PayrollService);
    ledgers = module.get(HrLedgersService);
    commissions = module.get(CommissionsService);
    leave = module.get(HrLeaveService);
    schedule = module.get(HrScheduleService);

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
