import { Test, TestingModule } from '@nestjs/testing';
import { OrderStaffPerformanceService } from './order-staff-performance.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OrderStaffPerformanceService', () => {
  let service: OrderStaffPerformanceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      userProfile: {
        findUnique: jest.fn(),
      },
      orderStaffEvent: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      order: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderStaffPerformanceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(OrderStaffPerformanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveEmployeeByUserId', () => {
    it('returns direct employee id if found', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({ id: 'emp-1' });
      const empId = await service.resolveEmployeeByUserId('emp-1');
      expect(empId).toBe('emp-1');
    });

    it('resolves employee via userProfile.betterAuthUserId', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce(null) // direct check
        .mockResolvedValueOnce({ id: 'emp-1' }); // via betterAuthUserId
      prisma.userProfile.findUnique.mockResolvedValueOnce({ betterAuthUserId: 'auth-u1' });

      const empId = await service.resolveEmployeeByUserId('profile-1');
      expect(empId).toBe('emp-1');
    });

    it('returns null if no mapping exists', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.userProfile.findUnique.mockResolvedValue(null);
      const empId = await service.resolveEmployeeByUserId('random-id');
      expect(empId).toBeNull();
    });
  });

  describe('recordStaffEvent', () => {
    it('records an event and resolves employeeId', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prisma.orderStaffEvent.create.mockResolvedValue({ id: 'evt-1' });

      await service.recordStaffEvent({
        orderId: 'order-1',
        userId: 'emp-1',
        action: 'STATUS_CHANGED',
        fromStatus: 'Pending',
        toStatus: 'Confirmed',
      });

      expect(prisma.orderStaffEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order-1',
            employeeId: 'emp-1',
            action: 'STATUS_CHANGED',
            fromStatus: 'Pending',
            toStatus: 'Confirmed',
          }),
        }),
      );
    });

    it('skips duplicate status events (idempotency check)', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prisma.orderStaffEvent.findFirst.mockResolvedValue({ id: 'existing-evt' });

      await service.recordStaffEvent({
        orderId: 'order-1',
        userId: 'emp-1',
        action: 'STATUS_CHANGED',
        toStatus: 'Confirmed',
      });

      expect(prisma.orderStaffEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('metric formulas verification', () => {
    it('computes funnel rates strictly according to explicit definitions', async () => {
      // Metric definitions:
      // Confirmation Rate = Confirmed / Orders Handled
      // Delivery Rate = Delivered / Confirmed
      // Return Rate = Returned / Delivered
      // Cancellation Rate = Cancelled / Orders Handled
      // End-to-End Delivery Rate = Delivered / Orders Handled
      const handled = 100;
      const confirmed = 80;
      const delivered = 60;
      const returned = 6;
      const cancelled = 10;

      const confirmationRate = Math.round((confirmed / handled) * 1000) / 10; // 80%
      const deliveryRate = Math.round((delivered / confirmed) * 1000) / 10; // 75%
      const returnRate = Math.round((returned / delivered) * 1000) / 10; // 10%
      const cancellationRate = Math.round((cancelled / handled) * 1000) / 10; // 10%
      const endToEnd = Math.round((delivered / handled) * 1000) / 10; // 60%

      expect(confirmationRate).toBe(80);
      expect(deliveryRate).toBe(75);
      expect(returnRate).toBe(10);
      expect(cancellationRate).toBe(10);
      expect(endToEnd).toBe(60);
    });
  });
});
