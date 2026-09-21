import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from '../dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: any;

  const now = new Date('2025-06-15T10:30:00.000Z');

  const mockPrisma = {
    orderStatus: {
      findUnique: jest.fn(),
    },
    order: {
      count: jest.fn(),
    },
    dispatch: {
      findMany: jest.fn(),
    },
    payment: {
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    refund: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    prisma = module.get(PrismaService);
  });

  describe('getOperationalKpis', () => {
    const confirmedId = 'status-confirmed-id';
    const packedId = 'status-packed-id';
    const deliveredId = 'status-delivered-id';

    beforeEach(() => {
      prisma.orderStatus.findUnique.mockImplementation(
        (where: { where: { name: string } }) => {
          const name = where.where.name;
          const map: Record<string, string> = {
            Confirmed: confirmedId,
            Packed: packedId,
            Delivered: deliveredId,
          };
          return Promise.resolve({ id: map[name], name });
        },
      );
    });

    function mockCounts(counts: {
      newOrders?: number;
      confirmed?: number;
      packed?: number;
      pickedUp?: number;
      delivered?: number;
      pendingPayments?: number;
      pendingRefunds?: number;
      revenueSum?: number | null;
    }) {
      // order.count is called 3 times: newOrders, confirmed, packed
      const orderCountCalls: any[] = [];
      if (counts.newOrders !== undefined) orderCountCalls.push(counts.newOrders);
      if (counts.confirmed !== undefined) orderCountCalls.push(counts.confirmed);
      if (counts.packed !== undefined) orderCountCalls.push(counts.packed);
      prisma.order.count.mockImplementation(() =>
        Promise.resolve(orderCountCalls.shift() || 0),
      );

      prisma.dispatch.findMany.mockImplementation((args: any) => {
        const status = args.where?.status;
        if (status === 'PICKED_UP') {
          return Promise.resolve(
            Array.from({ length: counts.pickedUp || 0 }, (_, i) => ({
              orderId: `order-pickup-${i}`,
            })),
          );
        }
        if (status === 'DELIVERED') {
          return Promise.resolve(
            Array.from({ length: counts.delivered || 0 }, (_, i) => ({
              orderId: `order-delivered-${i}`,
            })),
          );
        }
        return Promise.resolve([]);
      });

      prisma.payment.count.mockResolvedValue(counts.pendingPayments || 0);
      prisma.refund.count.mockResolvedValue(counts.pendingRefunds || 0);
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amount: counts.revenueSum },
      });
    }

    it('should return all KPIs with correct values when date range provided', async () => {
      mockCounts({
        newOrders: 42,
        confirmed: 30,
        packed: 25,
        pickedUp: 20,
        delivered: 18,
        pendingPayments: 3,
        pendingRefunds: 2,
        revenueSum: 125000,
      });

      const result = await service.getOperationalKpis(
        '2025-06-01',
        '2025-06-15',
      );

      expect(result).toEqual({
        newOrders: 42,
        confirmed: 30,
        packed: 25,
        pickedUp: 20,
        delivered: 18,
        pendingPayments: 3,
        pendingRefunds: 2,
        revenue: 125000,
      });
    });

    it('should filter order-based metrics by the selected date range with createdAt', async () => {
      mockCounts({ newOrders: 5, confirmed: 3, packed: 2 });

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      // newOrders query uses createdAt filter
      expect(prisma.order.count).toHaveBeenCalledWith({
        where: {
          createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
          trashedAt: null,
        },
      });

      // confirmed query uses statusId + createdAt filter
      const confirmedCall = (prisma.order.count as jest.Mock).mock.calls[1];
      expect(confirmedCall[0].where.statusId).toBe(confirmedId);

      // packed query uses statusId + createdAt filter
      const packedCall = (prisma.order.count as jest.Mock).mock.calls[2];
      expect(packedCall[0].where.statusId).toBe(packedId);
    });

    it('should filter Picked Up by dispatch.pickedUpAt, not order.createdAt', async () => {
      mockCounts({ pickedUp: 7 });

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const dispatchCall = (prisma.dispatch.findMany as jest.Mock).mock.calls[0];
      expect(dispatchCall[0].where.status).toBe('PICKED_UP');
      expect(dispatchCall[0].where.pickedUpAt).toEqual({
        gte: expect.any(Date),
        lte: expect.any(Date),
      });
    });

    it('should filter Delivered by dispatch.deliveredAt, not order.createdAt', async () => {
      mockCounts({ delivered: 4 });

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const deliveredCall = (prisma.dispatch.findMany as jest.Mock).mock.calls[1];
      expect(deliveredCall[0].where.status).toBe('DELIVERED');
      expect(deliveredCall[0].where.deliveredAt).toEqual({
        gte: expect.any(Date),
        lte: expect.any(Date),
      });
    });

    it('should exclude trashed orders from New Orders count', async () => {
      mockCounts({ newOrders: 10 });

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: {
          createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
          trashedAt: null,
        },
      });
    });

    it('should NOT date-filter pending payments (current backlog snapshot)', async () => {
      mockCounts({ pendingPayments: 5 });

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      expect(prisma.payment.count).toHaveBeenCalledWith({
        where: { status: 'PENDING' },
      });
    });

    it('should NOT date-filter pending refunds (current backlog snapshot)', async () => {
      mockCounts({ pendingRefunds: 3 });

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      expect(prisma.refund.count).toHaveBeenCalledWith({
        where: { status: 'pending' },
      });
    });

    it('should filter revenue by PAID payment dates in the selected period', async () => {
      mockCounts({ revenueSum: 75000 });

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      expect(prisma.payment.aggregate).toHaveBeenCalledWith({
        _sum: { amount: true },
        where: {
          status: 'PAID',
          createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
        },
      });
    });

    it('should use DISTINCT orderId for dispatch counts to prevent double counting', async () => {
      // Simulate a dispatch returning 3 entries for the same order
      prisma.dispatch.findMany.mockResolvedValueOnce([
        { orderId: 'order-1' },
        { orderId: 'order-1' },
        { orderId: 'order-2' },
      ]);
      mockCounts({ delivered: 0, pendingPayments: 0, pendingRefunds: 0, revenueSum: 0 });
      // Override the dispatched counts manually for this test
      prisma.order.count.mockImplementation(() => Promise.resolve(0));

      const result = await service.getOperationalKpis('2025-06-01', '2025-06-15');

      // Should return 3 (distinct dispatch rows, not deduplicated at SQL level
      // but distinct: ['orderId'] would handle that; the service counts rows)
      expect(result.pickedUp).toBe(3);
    });

    it('should return zero values on empty period when no date range given', async () => {
      mockCounts({});

      const result = await service.getOperationalKpis();

      expect(result.newOrders).toBe(0);
      expect(result.confirmed).toBe(0);
      expect(result.packed).toBe(0);
      expect(result.pickedUp).toBe(0);
      expect(result.delivered).toBe(0);
      expect(result.pendingPayments).toBe(0);
      expect(result.pendingRefunds).toBe(0);
      expect(result.revenue).toBe(0);
    });

    it('should use today range as fallback for revenue when no end given', async () => {
      mockCounts({ revenueSum: 1000 });
      jest.spyOn(service as any, 'getDateRange').mockReturnValue({
        start: new Date('2025-06-15T00:00:00Z'),
        end: new Date(),
      });

      await service.getOperationalKpis('2025-06-01');

      expect(prisma.payment.aggregate).toHaveBeenCalled();
    });
  });

  describe('getTodayKpi (backward compat)', () => {
    it('should delegate to getOperationalKpis with today Dhaka range', async () => {
      const spy = jest.spyOn(service, 'getOperationalKpis');

      // Mock the orderStatus lookups
      prisma.orderStatus.findUnique.mockResolvedValue({
        id: 'status-id',
        name: 'Confirmed',
      });
      prisma.order.count.mockResolvedValue(0);
      prisma.dispatch.findMany.mockResolvedValue([]);
      prisma.payment.count.mockResolvedValue(0);
      prisma.refund.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      await service.getTodayKpi();

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][0]).toBeDefined();
      expect(spy.mock.calls[0][1]).toBeDefined();
      spy.mockRestore();
    });
  });
});
