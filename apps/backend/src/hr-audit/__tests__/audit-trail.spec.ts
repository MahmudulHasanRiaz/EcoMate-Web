import { Test, TestingModule } from '@nestjs/testing';
import { PayrollService } from '../../payroll/payroll.service';
import { EmployeesService } from '../../employees/employees.service';
import { HrPaymentsService } from '../../hr-payments/hr-payments.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { HrLeaveService } from '../../hr-leave/hr-leave.service';
import { HrAttendanceService } from '../../hr-attendance/hr-attendance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption';
import { AttendanceDevicesService } from '../../attendance-devices/attendance-devices.service';

function makePrismaMock() {
  return {
    employee: {
      findUnique: jest.fn().mockResolvedValue({ id: 'emp1', joiningDate: new Date('2024-01-01'), status: 'active' }),
      update: jest.fn().mockResolvedValue({}),
    },
    salaryStructure: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'ss1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    employmentHistory: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    payslip: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ps1', status: 'approved', netPay: 50000 }),
      update: jest.fn().mockResolvedValue({}),
    },
    payrollPayment: {
      create: jest.fn().mockResolvedValue({ id: 'pay1' }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      update: jest.fn().mockResolvedValue({ id: 'pay1', voidedAt: new Date(), voidedById: 'actor1', voidReason: 'test' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'pay1', payslipId: 'ps1', voidedAt: null }),
    },
    commissionEarning: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ce1', status: 'approved', amount: 1000, orderId: 'ord1' }),
    },
    commissionReversal: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'cr1' }),
    },
    order: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ord1', total: 10000 }),
    },
    orderStatus: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    leaveRequest: {
      update: jest.fn().mockResolvedValue({ id: 'lr1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'lr1', status: 'pending', startDate: new Date('2025-01-01'), endDate: new Date('2025-01-03'), employeeId: 'emp1', createdById: 'u1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    leaveType: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    attendanceDay: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ad1', status: 'present', workedMinutes: 480, breakMinutes: 60 }),
    },
    attendanceAdjustment: {
      create: jest.fn().mockResolvedValue({ id: 'aa1' }),
    },
    attendanceSession: { findUnique: jest.fn() },
    attendanceBreak: { findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn({
      salaryStructure: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({ id: 'ss1' }) },
      employee: { update: jest.fn().mockResolvedValue({}) },
      payrollPayment: { create: jest.fn().mockResolvedValue({ id: 'pay1' }), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }), update: jest.fn().mockResolvedValue({}) },
      payslip: { update: jest.fn().mockResolvedValue({}) },
      attendanceAdjustment: { create: jest.fn().mockResolvedValue({ id: 'aa1' }) },
      attendanceDay: { update: jest.fn().mockResolvedValue({}) },
      employmentHistory: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      leaveRequest: { update: jest.fn().mockResolvedValue({ id: 'lr1' }) },
    })),
  } as any;
}

describe('G-19/G-05/G-20 — HR audit trail (actor fields)', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let payroll: PayrollService;
  let employees: EmployeesService;
  let payments: HrPaymentsService;
  let commissions: CommissionsService;
  let leave: HrLeaveService;
  let attendance: HrAttendanceService;

  beforeEach(() => {
    prisma = makePrismaMock();

    payroll = new PayrollService(prisma);
    employees = new EmployeesService(prisma, {} as any, {} as any);
    payments = new HrPaymentsService(prisma);
    commissions = new CommissionsService(prisma);
    leave = new HrLeaveService(prisma);
    attendance = new HrAttendanceService(prisma);
  });

  it('PayrollService.setSalaryStructure passes createdById', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({ id: 'emp1', joiningDate: new Date('2024-01-01'), status: 'active' });
    await payroll.setSalaryStructure(
      { employeeId: 'emp1', basicSalary: 50000, effectiveFrom: '2025-06-01' },
      'actor-123',
    );

    const tx = await prisma.$transaction.mock.calls[0][0]({
      salaryStructure: prisma.salaryStructure,
      employee: prisma.employee,
    });
    expect(prisma.salaryStructure.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdById: 'actor-123' }),
      }),
    );
  });

  it('EmployeesService.update writes EmploymentHistory with changedById', async () => {
    prisma.employee.findUnique
      .mockResolvedValueOnce({
        id: 'emp1', status: 'active', employmentType: 'full_time',
        departmentId: 'd1', designationId: 'dg1', accessPresetId: null,
        reportingToId: null, joiningDate: new Date('2024-01-01'),
        exitDate: null, exitReason: null, confirmationDate: null,
        dateOfBirth: null, gender: null, nationality: null, nidNumber: null,
        presentAddress: null, permanentAddress: null, emergencyContactName: null,
        emergencyContactPhone: null, emergencyContactRelation: null,
        attendanceMethod: 'NONE', salary: 50000, bankAccountNo: null, bankName: null,
        department: { id: 'd1', name: 'Eng' }, designation: { id: 'dg1', name: 'SE' },
        reportingTo: null,
      })
      .mockResolvedValueOnce(null); // for any validation lookups

    // Capture the tx mock returned by $transaction
    let txMock: any;
    prisma.$transaction.mockImplementationOnce(async (fn: any) => {
      txMock = {
        employee: { update: jest.fn().mockResolvedValue({}) },
        employmentHistory: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        leaveRequest: { update: jest.fn().mockResolvedValue({ id: 'lr1' }) },
      };
      return fn(txMock);
    });

    await employees.update('emp1', { status: 'on_leave' }, 'actor-456');

    expect(txMock.employmentHistory.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ changedById: 'actor-456' }),
        ]),
      }),
    );
  });

  it('HrPaymentsService.voidPayment records voidedById + voidReason', async () => {
    prisma.payslip.findUnique.mockResolvedValueOnce({ id: 'ps1', status: 'paid', netPay: 50000 });
    prisma.payrollPayment.findUnique.mockResolvedValueOnce({ id: 'pay1', payslipId: 'ps1', voidedAt: null, amount: 10000 });
    prisma.payrollPayment.aggregate.mockResolvedValueOnce({ _sum: { amount: 10000 } });
    const txMock = {
      payrollPayment: {
        update: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      payslip: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(txMock));

    await payments.voidPayment('ps1', 'pay1', 'Duplicate payment', 'actor-789');

    expect(txMock.payrollPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          voidedById: 'actor-789',
          voidReason: 'Duplicate payment',
        }),
      }),
    );
  });

  it('CommissionsService.reverseEarning records reversedById', async () => {
    prisma.commissionEarning.findUnique.mockResolvedValueOnce({
      id: 'ce1', status: 'approved', amount: 1000, orderId: 'ord1',
    });
    prisma.commissionReversal.findFirst.mockResolvedValueOnce(null);
    prisma.order.findUnique.mockResolvedValueOnce({ id: 'ord1', total: 10000 });

    await commissions.reverseEarning(
      'ce1',
      { reason: 'Order refunded', orderId: 'ord1' },
      'actor-abc',
    );

    expect(prisma.commissionReversal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reversedById: 'actor-abc' }),
      }),
    );
  });

  it('HrLeaveService.approveRequest records approvedById', async () => {
    prisma.leaveRequest.findUnique.mockResolvedValueOnce({
      id: 'lr1', status: 'pending', startDate: new Date('2025-01-01'),
      endDate: new Date('2025-01-03'), employeeId: 'emp1', createdById: 'u1',
    });

    await leave.approveRequest('lr1', { decisionNote: 'OK' }, 'actor-def');

    expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvedById: 'actor-def' }),
      }),
    );
  });

  it('HrAttendanceService.adjust records adjustedById', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({ id: 'emp1' });
    prisma.attendanceDay.findUnique.mockResolvedValueOnce({
      id: 'ad1', status: 'present', workedMinutes: 480, breakMinutes: 60,
    });
    const txMock = {
      attendanceDay: { update: jest.fn().mockResolvedValue({}) },
      attendanceAdjustment: { create: jest.fn().mockResolvedValue({ id: 'aa1' }) },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(txMock));

    await attendance.adjust('emp1', {
      field: 'workedMinutes',
      dayId: 'ad1',
      originalValue: '480',
      correctedValue: '500',
      reason: 'Forgot to log break',
    }, 'actor-ghi');

    expect(txMock.attendanceAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adjustedById: 'actor-ghi' }),
      }),
    );
  });
});
