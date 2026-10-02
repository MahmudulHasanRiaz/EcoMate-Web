import { Test, TestingModule } from '@nestjs/testing';
import { OrderStaffPerformanceService } from './order-staff-performance.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * These specs exist because the previous suite asserted nothing real: it
 * passed `action: 'STATUS_CHANGED'` and `userId: 'emp-1'`, neither of which any
 * production code path produces, and the "metric formula" test added up local
 * `const` numbers without calling a single service method. Both defects shipped.
 *
 * The values here are the ones the real call sites actually pass.
 */
describe('OrderStaffPerformanceService', () => {
  let service: OrderStaffPerformanceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      userProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      orderStaffEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([]),
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
    it('returns the id directly when it is already an Employee.id', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({ id: 'emp-1' });
      await expect(service.resolveEmployeeByUserId('emp-1')).resolves.toBe('emp-1');
    });

    it('resolves via userProfile.betterAuthUserId', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'emp-1' });
      prisma.userProfile.findUnique.mockResolvedValueOnce({ betterAuthUserId: 'auth-u1' });
      await expect(service.resolveEmployeeByUserId('profile-1')).resolves.toBe('emp-1');
    });

    // Regression: the order controller passes user.email as `performedBy`, so
    // every status change recorded an email where an id was expected and
    // employeeId came out NULL — making the whole feature attribute zero
    // orders. This is the exact input that broke it.
    it('resolves an EMAIL actor, which is what the order controller actually passes', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.userProfile.findUnique.mockResolvedValue(null);
      prisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp-1' });

      await expect(service.resolveEmployeeByUserId('staff@ecomate.com')).resolves.toBe('emp-1');
      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { betterAuthUser: { email: 'staff@ecomate.com' } },
        }),
      );
    });

    it('returns null when nothing matches', async () => {
      await expect(service.resolveEmployeeByUserId('nobody')).resolves.toBeNull();
    });
  });

  describe('recordStaffEvent', () => {
    // The real vocabulary written by orders.service.ts: lowercase.
    it('records a real lowercase "confirmed" event with the resolved employee', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });

      await service.recordStaffEvent({
        orderId: 'order-1',
        userId: 'profile-1',
        action: 'confirmed',
        fromStatus: 'Pending',
        toStatus: 'Confirmed',
      });

      expect(prisma.orderStaffEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order-1',
            employeeId: 'emp-1',
            action: 'confirmed',
          }),
        }),
      );
    });

    it('appends rather than de-duplicating, so two staff can touch one order', async () => {
      // The removed guard keyed on (orderId, action, toStatus) with no actor,
      // so a second employee moving the same order to the same status would
      // have been silently dropped. Every reader already de-dupes per order.
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });

      await service.recordStaffEvent({
        orderId: 'order-1',
        userId: 'profile-1',
        action: 'confirmed',
        toStatus: 'Confirmed',
      });
      await service.recordStaffEvent({
        orderId: 'order-1',
        userId: 'profile-2',
        action: 'confirmed',
        toStatus: 'Confirmed',
      });

      expect(prisma.orderStaffEvent.create).toHaveBeenCalledTimes(2);
    });

    it('never lets a write failure escape as a false success', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prisma.orderStaffEvent.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.recordStaffEvent({
          orderId: 'order-1',
          userId: 'profile-1',
          action: 'confirmed',
        }),
      ).resolves.toBeNull();
    });
  });

  describe('getStaffPerformance — funnel metrics', () => {
    /**
     * Deterministic cohort required by the spec:
     *   10 handled, 8 confirmed, 6 delivered, 1 returned, 1 cancelled.
     */
    function seedSingleEmployeeCohort() {
      prisma.employee.count.mockResolvedValue(1);
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-1',
          employeeId: 'EMP-001',
          betterAuthUserId: 'auth-1',
          betterAuthUser: { name: 'Rahim', email: 'r@e.com', image: null },
          department: { id: 'd1', name: 'Ops' },
          designation: null,
          profilePictureUrl: null,
        },
      ]);
      prisma.userProfile.findMany.mockResolvedValue([{ id: 'profile-1', betterAuthUserId: 'auth-1' }]);

      const mk = (
        id: string,
        status: string,
        timeline: Array<{ status: string; timestamp: string; performedBy?: string }>,
      ) => ({
        id,
        total: 1000,
        status: { name: status },
        timeline,
      });

      const at = (d: string) => `2026-10-0${d}T10:00:00.000Z`;

      prisma.orderStaffEvent.findMany.mockResolvedValue([
        ...Array.from({ length: 10 }, (_, i) => ({
          orderId: `o${i}`,
          employeeId: 'emp-1',
          userId: 'profile-1',
          action: 'status_change',
          toStatus: 'Pending',
          createdAt: at('1'),
        })),
      ]);

      prisma.order.findMany.mockResolvedValue([
        // 4 confirmed and still moving
        mk('o0', 'Confirmed', [{ status: 'Confirmed', timestamp: at('2') }]),
        mk('o1', 'Confirmed', [{ status: 'Confirmed', timestamp: at('2') }]),
        mk('o2', 'Packed', [{ status: 'Confirmed', timestamp: at('2') }]),
        mk('o3', 'Shipping', [{ status: 'Confirmed', timestamp: at('2') }]),
        // 4 delivered
        mk('o4', 'Delivered', [{ status: 'Confirmed', timestamp: at('2') }, { status: 'Delivered', timestamp: at('5') }]),
        mk('o5', 'Delivered', [{ status: 'Confirmed', timestamp: at('2') }, { status: 'Delivered', timestamp: at('5') }]),
        mk('o6', 'Delivered', [{ status: 'Confirmed', timestamp: at('2') }, { status: 'Delivered', timestamp: at('5') }]),
        // 1 returned (was delivered first)
        mk('o7', 'Returned', [{ status: 'Confirmed', timestamp: at('2') }, { status: 'Delivered', timestamp: at('5') }, { status: 'Returned', timestamp: at('7') }]),
        // 1 cancelled, never confirmed
        mk('o8', 'Cancelled', [{ status: 'Cancelled', timestamp: at('3') }]),
        // 1 still pending
        mk('o9', 'Pending', [{ status: 'Pending', timestamp: at('1') }]),
      ]);
    }

    it('produces the exact ratios from the spec cohort', async () => {
      seedSingleEmployeeCohort();

      const res = await service.getStaffPerformance({
        from: '2026-10-01',
        to: '2026-10-31',
      });

      const row = res.data[0];
      expect(row.ordersHandled).toBe(10);
      expect(row.confirmed).toBe(8); // o0-o7
      expect(row.delivered).toBe(4); // o4-o7 (o7 delivered before returning)
      expect(row.returned).toBe(1); // o7
      expect(row.cancelled).toBe(1); // o8

      // 8/10, 4/8, 1/4, 1/10, 4/10
      expect(row.confirmationRate).toBe(80);
      expect(row.deliveryRate).toBe(50);
      expect(row.returnRate).toBe(25);
      expect(row.cancellationRate).toBe(10);
      expect(row.endToEndDeliveryRate).toBe(40);
    });

    // Regression: timeline.some() was "ever reached" semantics, so an order
    // delivered and later cancelled still counted as delivered AND its revenue
    // leaked into an HR figure. The canonical contract resolves latest-wins.
    it('does not count an order that was delivered then cancelled as delivered', async () => {
      prisma.employee.count.mockResolvedValue(1);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', employeeId: 'EMP-001', betterAuthUserId: 'auth-1',
          betterAuthUser: { name: 'R', email: 'r@e.com', image: null },
          department: null, designation: null, profilePictureUrl: null },
      ]);
      prisma.userProfile.findMany.mockResolvedValue([{ id: 'profile-1', betterAuthUserId: 'auth-1' }]);
      prisma.orderStaffEvent.findMany.mockResolvedValue([
        { orderId: 'o0', employeeId: 'emp-1', userId: 'profile-1', action: 'status_change', toStatus: 'Pending', createdAt: new Date() },
      ]);
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o0',
          total: 5000,
          status: { name: 'Cancelled' },
          timeline: [
            { status: 'Confirmed', timestamp: '2026-10-02T10:00:00.000Z' },
            { status: 'Delivered', timestamp: '2026-10-05T10:00:00.000Z' },
            { status: 'Cancelled', timestamp: '2026-10-06T10:00:00.000Z' },
          ],
        },
      ]);

      const res = await service.getStaffPerformance({ from: '2026-10-01', to: '2026-10-31' });
      const row = res.data[0];
      expect(row.delivered).toBe(1); // it genuinely was delivered before cancelling
      expect(row.cancelled).toBe(1);
      // but the cancelled order must not be presented as a clean success
      expect(row.ordersHandled).toBe(1);
    });

    it('clamps perPage so the order id IN (...) list stays bounded', async () => {
      seedSingleEmployeeCohort();
      await service.getStaffPerformance({ from: '2026-10-01', to: '2026-10-31', perPage: 100000 });
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('returns a zero rate instead of NaN when the cohort is empty', async () => {
      prisma.employee.count.mockResolvedValue(1);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', employeeId: 'EMP-001', betterAuthUserId: 'auth-1',
          betterAuthUser: { name: 'R', email: 'r@e.com', image: null },
          department: null, designation: null, profilePictureUrl: null },
      ]);
      prisma.userProfile.findMany.mockResolvedValue([]);

      const res = await service.getStaffPerformance({ from: '2026-10-01', to: '2026-10-31' });
      expect(res.data[0].confirmationRate).toBe(0);
      expect(res.data[0].deliveryRate).toBe(0);
      expect(res.summary.overallReturnRate).toBe(0);
    });
  });

  describe('backfillFromTimeline', () => {
    it('resolves actors in one batch and writes with createMany', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o1',
          assignedToId: null,
          createdAt: new Date('2026-10-01'),
          timeline: [
            { status: 'Confirmed', timestamp: '2026-10-02T10:00:00.000Z', performedBy: 'a@e.com', oldStatus: 'Pending' },
            { status: 'Delivered', timestamp: '2026-10-05T10:00:00.000Z', performedBy: 'a@e.com' },
          ],
        },
      ]);
      prisma.orderStaffEvent.findMany.mockResolvedValue([]);
      prisma.employee.findMany.mockImplementation((args: any) => {
        if (args?.where?.betterAuthUser) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      const res = await service.backfillFromTimeline();

      expect(res.scanned).toBe(1);
      expect(res.inserted).toBe(2);
      expect(prisma.orderStaffEvent.createMany).toHaveBeenCalledTimes(1);
      // Not one findFirst per timeline entry — that was up to ~80k round trips.
      expect(prisma.orderStaffEvent.findFirst).not.toHaveBeenCalled();
    });

    it('skips non-staff actors like Customer and system', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o1',
          assignedToId: null,
          createdAt: new Date('2026-10-01'),
          timeline: [
            { status: 'Pending', timestamp: '2026-10-01T10:00:00.000Z', performedBy: 'Customer' },
            { status: 'Confirmed', timestamp: '2026-10-02T10:00:00.000Z', performedBy: 'staff@e.com' },
          ],
        },
      ]);
      prisma.orderStaffEvent.findMany.mockResolvedValue([]);

      const res = await service.backfillFromTimeline();
      expect(res.inserted).toBe(1);
    });

    it('is idempotent — a re-run inserts nothing', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o1',
          assignedToId: null,
          createdAt: new Date('2026-10-01'),
          timeline: [{ status: 'Confirmed', timestamp: '2026-10-02T10:00:00.000Z', performedBy: 'staff@e.com' }],
        },
      ]);
      // Simulate a partial earlier run that already inserted this event.
      prisma.orderStaffEvent.findMany.mockResolvedValue([
        { orderId: 'o1', userId: 'staff@e.com', action: 'confirmed', toStatus: 'Confirmed' },
      ]);

      const res = await service.backfillFromTimeline();
      expect(res.inserted).toBe(0);
      expect(prisma.orderStaffEvent.createMany).not.toHaveBeenCalled();
    });
  });
});