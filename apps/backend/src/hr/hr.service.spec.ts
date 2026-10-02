import { Test, TestingModule } from '@nestjs/testing';
import { HrService } from './hr.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStaffPerformanceService } from '../orders/order-staff-performance.service';

describe('HrService', () => {
  let service: HrService;
  let prisma: any;
  let staffPerformance: any;

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
      attendanceDay: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'PRESENT', _count: { _all: 2 } },
          { status: 'LATE', _count: { _all: 1 } },
        ]),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { workedMinutes: 960, breakMinutes: 60, overtimeMinutes: 30 },
        }),
      },
      attendanceSession: {
        findMany: jest.fn().mockResolvedValue([
          { id: 's1', checkOutAt: null, breaks: [] },
          { id: 's2', checkOutAt: null, breaks: [{ id: 'b1' }] },
        ]),
        count: jest.fn().mockResolvedValue(0),
      },
      leaveRequest: {
        count: jest.fn().mockResolvedValue(0),
      },
      task: {
        count: jest.fn().mockResolvedValue(0),
      },
      orderStaffEvent: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    // The order funnel is delegated to OrderStaffPerformanceService so the
    // dashboard and the performance page cannot drift apart. It used to be
    // counted inline with action literals ('ASSIGNED'/'STATUS_CHANGED') that no
    // code path has ever written, so every figure rendered as a silent 0.
    staffPerformance = {
      getStaffPerformance: jest.fn().mockResolvedValue({
        data: [],
        summary: {
          totalOrdersHandled: 100,
          totalConfirmed: 80,
          overallConfirmationRate: 80,
          totalDelivered: 60,
          overallDeliveryRate: 75,
          overallEndToEndDeliveryRate: 60,
          totalReturned: 6,
          overallReturnRate: 10,
          totalCancelled: 10,
          overallCancellationRate: 10,
          totalRevenue: 100000,
        },
        meta: { page: 1, perPage: 200, total: 1, totalPages: 1, from: '2026-10-01', to: '2026-10-31' },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrderStaffPerformanceService, useValue: staffPerformance },
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
      (call: any[]) => call[0].where.status === 'paid',
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

  it('should include live attendance metrics in overview', async () => {
    const result = await service.getOverview();
    expect(result.attendance).toBeDefined();
    expect(result.attendance.currentlyWorking).toBe(1);
    expect(result.attendance.onBreak).toBe(1);
    expect(result.attendance.present).toBe(3); // PRESENT (2) + LATE (1)
  });

  describe('order operations KPIs', () => {
    it('surfaces the funnel summary rather than a hand-rolled count', async () => {
      const result = await service.getOverview();

      expect(result.orderOperations.handled).toBe(100);
      expect(result.orderOperations.confirmed).toBe(80);
      expect(result.orderOperations.confirmationRate).toBe(80);
      expect(result.orderOperations.delivered).toBe(60);
      expect(result.orderOperations.deliveryRateFromConfirmed).toBe(75);
      expect(result.orderOperations.returned).toBe(6);
      expect(result.orderOperations.returnRate).toBe(10);
      expect(result.orderOperations.cancelled).toBe(10);
      expect(result.orderOperations.cancellationRate).toBe(10);

      // It must come from the shared aggregator, not a raw event count.
      expect(staffPerformance.getStaffPerformance).toHaveBeenCalled();
      expect(prisma.orderStaffEvent.count).not.toHaveBeenCalled();
    });

    it('walks every page so a large workforce is not truncated at 200', async () => {
      staffPerformance.getStaffPerformance
        .mockResolvedValueOnce({
          data: [],
          summary: {
            totalOrdersHandled: 60, totalConfirmed: 30, overallConfirmationRate: 50,
            totalDelivered: 20, overallDeliveryRate: 66.7, overallEndToEndDeliveryRate: 33.3,
            totalReturned: 2, overallReturnRate: 10, totalCancelled: 4,
            overallCancellationRate: 6.7, totalRevenue: 0,
          },
          meta: { page: 1, perPage: 200, total: 450, totalPages: 3 },
        })
        .mockResolvedValue({
          data: [],
          summary: {
            totalOrdersHandled: 10, totalConfirmed: 5, overallConfirmationRate: 50,
            totalDelivered: 5, overallDeliveryRate: 100, overallEndToEndDeliveryRate: 50,
            totalReturned: 0, overallReturnRate: 0, totalCancelled: 0,
            overallCancellationRate: 0, totalRevenue: 0,
          },
          meta: { page: 2, perPage: 200, total: 450, totalPages: 3 },
        });

      const result = await service.getOverview();
      // Pages 2 and 3 both return the 10/5 row (mockResolvedValue is sticky),
      // so the walk sums page 1 + page 2 + page 3 = 60 + 10 + 10 = 80 handled,
      // 30 + 5 + 5 = 40 confirmed ⇒ 50%.
      expect(staffPerformance.getStaffPerformance).toHaveBeenCalledTimes(3);
      expect(result.orderOperations.handled).toBe(80);
      expect(result.orderOperations.confirmed).toBe(40);
      expect(result.orderOperations.confirmationRate).toBe(50);
    });
  });

  describe('payroll visibility', () => {
    it('includes payroll figures by default', async () => {
      const result = await service.getOverview();
      expect(result.payroll).toBeDefined();
      expect(result.recentPayments).toHaveLength(1);
    });

    // GET /hr/overview is guarded by manage_payroll; the workforce variant is
    // not, so it must not carry salary data at all.
    it('omits payroll entirely when includePayroll is false', async () => {
      const result = await service.getOverview({ includePayroll: false });
      expect(result.payroll).toBeUndefined();
      expect(result.recentPayments).toBeUndefined();
      // but the operational figures still come through
      expect(result.employees).toBeDefined();
      expect(result.attendance).toBeDefined();
      expect(result.orderOperations).toBeDefined();
    });
  });
});
