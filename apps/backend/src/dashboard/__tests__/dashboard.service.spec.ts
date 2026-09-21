import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { DashboardService } from '../dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: any;

  const mockPrisma = {
    order: { count: jest.fn() },
    payment: { count: jest.fn(), aggregate: jest.fn() },
    refund: { count: jest.fn() },
    $queryRawUnsafe: jest.fn(),
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
    /** Default happy-path mocks: order count, lifecycle query, snapshots. */
    function mockAll(overrides: {
      newOrders?: number;
      confirmed?: number;
      packed?: number;
      pickedUp?: number;
      delivered?: number;
      pendingPayments?: number;
      pendingRefunds?: number;
      revenue?: number | null;
    }) {
      prisma.order.count.mockResolvedValue(overrides.newOrders ?? 0);
      prisma.$queryRawUnsafe.mockResolvedValue([
        {
          confirmed: overrides.confirmed ?? 0,
          packed: overrides.packed ?? 0,
          picked_up: overrides.pickedUp ?? 0,
          delivered: overrides.delivered ?? 0,
        },
      ]);
      prisma.payment.count.mockResolvedValue(overrides.pendingPayments ?? 0);
      prisma.refund.count.mockResolvedValue(overrides.pendingRefunds ?? 0);
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amount: overrides.revenue ?? 0 },
      });
    }

    it('returns the full operational KPI payload with view-friendly names', async () => {
      mockAll({
        newOrders: 42,
        confirmed: 30,
        packed: 25,
        pickedUp: 20,
        delivered: 18,
        pendingPayments: 7,
        pendingRefunds: 2,
        revenue: 125000,
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
        pendingPayments: 7,
        pendingRefunds: 2,
        revenue: 125000,
      });
    });

    // ── New Orders: creation event on the canonical column ──────────────
    it('counts New Orders by order createdAt within the period, excluding trashed', async () => {
      mockAll({});
      const start = new Date('2025-06-01T00:00:00.000Z');
      const end = new Date('2025-06-15T23:59:59.999Z');

      await service.getOperationalKpis(start.toISOString(), end.toISOString());

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { createdAt: { gte: start, lte: end }, trashedAt: null },
      });
    });

    // ── Lifecycle events: transition-based, not current-status based ─────
    it('derives Confirmed/Packed/Picked Up/Delivered from lifecycle events, not current order status', async () => {
      mockAll({ confirmed: 11, packed: 4, pickedUp: 3, delivered: 9 });

      const result = await service.getOperationalKpis(
        '2025-06-01',
        '2025-06-15',
      );

      // The lifecycle query is a raw event aggregation — an order delivered
      // in the period still counts after it later moves on, so this can never
      // be expressed as a current-status count.
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
      expect(prisma.order.count).toHaveBeenCalledTimes(1); // New Orders only
      expect(result.confirmed).toBe(11);
      expect(result.packed).toBe(4);
      expect(result.pickedUp).toBe(3);
      expect(result.delivered).toBe(9);
    });

    it('passes the selected period to the lifecycle query as bound parameters', async () => {
      mockAll({});
      const start = new Date('2025-06-01T00:00:00.000Z');
      const end = new Date('2025-06-15T23:59:59.999Z');

      await service.getOperationalKpis(start.toISOString(), end.toISOString());

      const params = prisma.$queryRawUnsafe.mock.calls[0].slice(1);
      expect(params).toEqual([start, end]);
    });

    it('lifecycle query deduplicates orders across sources and repeated transitions', async () => {
      mockAll({});

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      // DISTINCT order_id for every metric → no double counting from
      // multiple dispatches or Confirmed→Hold→Confirmed cycles.
      expect(sql).toContain('COUNT(DISTINCT order_id) FILTER');
      expect(sql).toMatch(/status = 'Confirmed'/);
      expect(sql).toMatch(/status = 'Packed'/);
      expect(sql).toMatch(/status = 'PICKED_UP'/);
      expect(sql).toMatch(/status IN \('Delivered', 'DELIVERED'\)/);
    });

    it('lifecycle query unions the order timeline with dispatch event timestamps', async () => {
      mockAll({});

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      // Source 1: order timeline transitions (manual + courier-driven).
      expect(sql).toContain('jsonb_array_elements');
      expect(sql).toContain('timeline');
      // Source 2: dispatch pickup/delivery event columns.
      expect(sql).toContain('"pickedUpAt"');
      expect(sql).toContain('"deliveredAt"');
    });

    it('lifecycle query excludes trashed orders and guards malformed timestamps', async () => {
      mockAll({});

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      // Trashed orders can never contribute to a KPI.
      expect(sql).toMatch(/"trashedAt" IS NULL/g);
      // Defensive guards so a malformed/incomplete timeline entry can never
      // crash the aggregate (missing timestamp / non-ISO value).
      expect(sql).toContain("e ? 'timestamp'");
      expect(sql).toContain("e->>'timestamp' ~");
    });

    // ── Pending Payments / Refunds: explicit current-state snapshots ─────
    it('reports Pending Payments as a current backlog snapshot (not period-filtered)', async () => {
      mockAll({ pendingPayments: 7 });

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      expect(prisma.payment.count).toHaveBeenCalledWith({
        where: { status: 'PENDING' },
      });
    });

    it('reports Pending Refunds as a current backlog snapshot (not period-filtered)', async () => {
      mockAll({ pendingRefunds: 2 });

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      expect(prisma.refund.count).toHaveBeenCalledWith({
        where: { status: 'pending' },
      });
    });

    // ── Revenue: payment event on the payment date ──────────────────────
    it('sums Revenue from PAID payments dated by the payment createdAt', async () => {
      mockAll({ revenue: 75000 });
      const start = new Date('2025-06-01T00:00:00.000Z');
      const end = new Date('2025-06-15T23:59:59.999Z');

      await service.getOperationalKpis(start.toISOString(), end.toISOString());

      expect(prisma.payment.aggregate).toHaveBeenCalledWith({
        _sum: { amount: true },
        where: {
          status: 'PAID',
          createdAt: { gte: start, lte: end },
        },
      });
    });

    it('returns 0 revenue when the aggregate sum is null', async () => {
      mockAll({ revenue: null });

      const result = await service.getOperationalKpis(
        '2025-06-01',
        '2025-06-15',
      );

      expect(result.revenue).toBe(0);
    });

    // ── Period boundaries ──────────────────────────────────────────────
    it('defaults the period end to now and the start to epoch when no range is given', async () => {
      mockAll({});
      const before = Date.now();

      await service.getOperationalKpis();

      const [start, end] = prisma.$queryRawUnsafe.mock.calls[0].slice(1);
      expect((start as Date).getTime()).toBe(0);
      expect((end as Date).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('applies an inclusive Dhaka-day range for a date-only custom range', async () => {
      mockAll({});

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const [start, end] = prisma.$queryRawUnsafe.mock.calls[0].slice(1) as Date[];
      // Dhaka midnight = 18:00Z the previous day.
      expect(start.toISOString()).toBe('2025-05-31T18:00:00.000Z');
      // End of the Dhaka day = 17:59:59.999Z on the selected day.
      expect(end.toISOString()).toBe('2025-06-15T17:59:59.999Z');
    });

    it('wraps database failures in an InternalServerErrorException', async () => {
      prisma.order.count.mockRejectedValue(new Error('db down'));

      await expect(
        service.getOperationalKpis('2025-06-01', '2025-06-15'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    // ── Timezone pinning ───────────────────────────────────────────────
    // Dispatch/Payment timestamp columns are `timestamp without time zone`
    // holding UTC wall clock. Comparing them bare against a timestamptz bound
    // silently shifts by the session offset (Asia/Dhaka = +6h), which made the
    // dispatch events disagree with the timeline events for the same period.
    it('pins dispatch event columns to UTC before comparing with period bounds', async () => {
      mockAll({});

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      expect(sql).toContain(`(d."pickedUpAt" AT TIME ZONE 'UTC')`);
      expect(sql).toContain(`(d."deliveredAt" AT TIME ZONE 'UTC')`);
    });

    it('pins the period parameters to UTC so the session timezone cannot shift them', async () => {
      mockAll({});

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      // DateTime params arrive as timezone-less UTC wall clock; casting them
      // straight to timestamptz would re-interpret them in the session zone.
      expect(sql).toContain(`($1::timestamp AT TIME ZONE 'UTC') AS range_start`);
      expect(sql).toContain(`($2::timestamp AT TIME ZONE 'UTC') AS range_end`);
    });
  });

  describe('UTC pinning in other period-filtered raw queries', () => {
    it('getTopProducts pins order createdAt to UTC', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getTopProducts('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      expect(sql).toContain(`(o."createdAt" AT TIME ZONE 'UTC')`);
    });

    it('getRevenueByPaymentMethod pins payment createdAt to UTC', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getRevenueByPaymentMethod('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      expect(sql).toContain(`("createdAt" AT TIME ZONE 'UTC')`);
    });
  });

  describe('getTodayKpi (backward compatibility)', () => {
    it('delegates to getOperationalKpis with the current Dhaka day range', async () => {
      const spy = jest
        .spyOn(service, 'getOperationalKpis')
        .mockResolvedValue({} as any);

      await service.getTodayKpi();

      expect(spy).toHaveBeenCalledTimes(1);
      const [startArg, endArg] = spy.mock.calls[0] as unknown as string[];
      const start = new Date(startArg);
      const end = new Date(endArg);
      // Dhaka day: exactly 24h minus 1ms, ending at ...:59:59.999Z.
      expect(end.getTime() - start.getTime()).toBe(86_399_999);
      expect(end.getUTCMinutes()).toBe(59);
      expect(start.getUTCHours()).toBe(18); // 18:00Z = 00:00 Dhaka
      spy.mockRestore();
    });
  });
});
