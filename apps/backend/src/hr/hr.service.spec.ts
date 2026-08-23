import { Test, TestingModule } from '@nestjs/testing';
import { HrService } from './hr.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HrService', () => {
  let service: HrService;
  let prisma: any;

  const mockEmployees = [
    { status: 'active', _count: { _all: 3 } },
    { status: 'on_leave', _count: { _all: 1 } },
    { status: 'terminated', _count: { _all: 1 } },
  ];

  const mockPayments = [
    {
      id: 'p1',
      netPay: { toString: () => '30000' },
      paidAt: new Date(),
      periodKey: '2026-08',
      employee: {
        employeeId: 'EMP-260818-0001',
        betterAuthUser: { name: 'John Doe' },
      },
    },
  ];

  beforeEach(async () => {
    prisma = {
      employee: {
        groupBy: jest.fn().mockResolvedValue(mockEmployees),
      },
      payslip: {
        count: jest.fn().mockResolvedValue(2),
        aggregate: jest.fn().mockResolvedValue({ _sum: { netPay: { toString: () => '150000' } } }),
        findFirst: jest.fn().mockResolvedValue({ periodKey: '2026-08' }),
        findMany: jest.fn().mockResolvedValue(mockPayments),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(HrService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should aggregate employee counts by status', async () => {
    const result = await service.getOverview();
    expect(result.employees).toEqual({
      total: 5,
      active: 3,
      inactive: 0,
      on_leave: 1,
      suspended: 0,
      terminated: 1,
      resigned: 0,
    });
  });

  it('should count pending approvals (draft + reviewed)', async () => {
    await service.getOverview();
    expect(prisma.payslip.count).toHaveBeenCalledWith({
      where: { status: { in: ['draft', 'reviewed'] } },
    });
  });

  it('should compute paid this month', async () => {
    const result = await service.getOverview();
    expect(result.payroll.paidThisMonth).toBe(150000);
    const aggregateCall = prisma.payslip.aggregate.mock.calls.find(
      (call) => call[0].where.status === 'paid',
    );
    expect(aggregateCall).toBeTruthy();
    expect(aggregateCall[0].where.paidAt.gte).toBeInstanceOf(Date);
  });

  it('should resolve last period key and its net sum', async () => {
    const result = await service.getOverview();
    expect(result.payroll.lastPeriodKey).toBe('2026-08');
    expect(prisma.payslip.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          periodKey: '2026-08',
          status: { in: ['paid', 'approved'] },
        },
      }),
    );
  });

  it('should return payable (approved + partially_paid)', async () => {
    const result = await service.getOverview();
    expect(result.payroll.payable).toBe(150000);
  });

  it('should map recent payments with employee names', async () => {
    const result = await service.getOverview();
    expect(result.recentPayments).toEqual([
      {
        id: 'p1',
        employeeId: 'EMP-260818-0001',
        employeeName: 'John Doe',
        netPay: 30000,
        paidAt: expect.any(Date),
        periodKey: '2026-08',
      },
    ]);
    expect(prisma.payslip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, orderBy: { paidAt: 'desc' } }),
    );
  });

  it('should return zero queues and commission placeholders', async () => {
    const result = await service.getOverview();
    expect(result.queues.pendingLeaveRequests).toBe(0);
    expect(result.commissionThisMonth).toBe(0);
  });

  it('should handle no last period payslip', async () => {
    prisma.payslip.findFirst.mockResolvedValue(null);
    const result = await service.getOverview();
    expect(result.payroll.lastPeriodKey).toBeNull();
    expect(result.payroll.lastPeriodNet).toBe(0);
  });
});