import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DashboardService } from '../dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: any;

  const mockPrisma = {
    order: { count: jest.fn(), groupBy: jest.fn() },
    orderStatus: { findMany: jest.fn() },
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
    /** The configured statuses (id/name/colour/lifecycle order). */
    const KPI_STATUSES = [
      { id: 'st-pending', name: 'Pending', color: '#F59E0B', sortOrder: 0 },
      { id: 'st-paypend', name: 'Payment Pending', color: '#F59E0B', sortOrder: 1 },
      { id: 'st-payver', name: 'Payment Verifying', color: '#8B5CF6', sortOrder: 2 },
      { id: 'st-hold', name: 'Hold', color: '#D97706', sortOrder: 3 },
      { id: 'st-confirmed', name: 'Confirmed', color: '#3B82F6', sortOrder: 4 },
      { id: 'st-packed', name: 'Packed', color: '#059669', sortOrder: 5 },
      { id: 'st-packhold', name: 'Packing Hold', color: '#D97706', sortOrder: 6 },
      { id: 'st-shipping', name: 'Shipping', color: '#06B6D4', sortOrder: 7 },
      { id: 'st-delivered', name: 'Delivered', color: '#10B981', sortOrder: 8 },
      { id: 'st-partial', name: 'Partial', color: '#F59E0B', sortOrder: 9 },
      { id: 'st-retpend', name: 'Return Pending', color: '#EC4899', sortOrder: 10 },
      { id: 'st-returned', name: 'Returned', color: '#DC2626', sortOrder: 11 },
      { id: 'st-damaged', name: 'Damaged', color: '#991B1B', sortOrder: 12 },
      { id: 'st-cancelled', name: 'Cancelled', color: '#EF4444', sortOrder: 13 },
    ];

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
      /** Per-status event rows (2nd raw query → `statusCounts`). */
      statusEvents?: Array<{ status: string | null; orders: number }>;
      /** Configured statuses (drives the `statusCounts` row list). */
      statuses?: Array<{
        id: string;
        name: string;
        color: string;
        sortOrder: number;
      }>;
    }) {
      prisma.order.count.mockResolvedValue(overrides.newOrders ?? 0);
      // One raw query: the per-status event GROUP BY that backs both
      // `statusCounts` and the legacy fixed fields. The legacy
      // confirmed/packed/pickedUp/delivered knobs are expressed as the
      // equivalent event rows so both views read the same source.
      prisma.$queryRawUnsafe.mockResolvedValue(
        overrides.statusEvents ?? [
          ...(overrides.confirmed != null
            ? [{ status: 'Confirmed', orders: overrides.confirmed }]
            : []),
          ...(overrides.packed != null
            ? [{ status: 'Packed', orders: overrides.packed }]
            : []),
          // Pickup events arrive normalized to 'Shipping': the lifecycle
          // query maps the dispatch/courier literal 'PICKED_UP' onto the
          // canonical status name before GROUP BY.
          ...(overrides.pickedUp != null
            ? [{ status: 'Shipping', orders: overrides.pickedUp }]
            : []),
          ...(overrides.delivered != null
            ? [{ status: 'Delivered', orders: overrides.delivered }]
            : []),
        ],
      );
      prisma.orderStatus.findMany.mockResolvedValue(
        overrides.statuses ?? KPI_STATUSES,
      );
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
        statuses: KPI_STATUSES,
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
        // One row per configured status, in lifecycle order; the dispatch
        // PICKED_UP events land on Shipping, not a phantom status.
        statusCounts: KPI_STATUSES.map((s) => ({
          name: s.name,
          count:
            s.name === 'Pending'
              ? 42
              : s.name === 'Confirmed'
                ? 30
                : s.name === 'Packed'
                  ? 25
                  : s.name === 'Shipping'
                    ? 20
                    : s.name === 'Delivered'
                      ? 18
                      : 0,
          color: s.color,
          sortOrder: s.sortOrder,
        })),
      });
    });

    // ── New Orders: creation event on the canonical column ──────────────
    it('counts New Orders by order createdAt within the period, excluding trashed', async () => {
      mockAll({});
      const start = new Date('2025-06-01T00:00:00.000Z');
      const end = new Date('2025-06-15T23:59:59.999Z');

      await service.getOperationalKpis(start.toISOString(), end.toISOString());

      // dhakaDayRange expands ISO datetimes to the full Dhaka day
      // containing each instant (audit §1c P0.3 — no more single-instant
      // passthrough): 00:00Z Jun 1 = 06:00 Dhaka Jun 1 → day starts
      // 2025-05-31T18:00Z; 23:59:59.999Z Jun 15 = 05:59:59.999 Dhaka
      // Jun 16 → day ends 2025-06-16T17:59:59.999Z.
      expect(prisma.order.count).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: new Date('2025-05-31T18:00:00.000Z'),
            lte: new Date('2025-06-16T17:59:59.999Z'),
          },
          trashedAt: null,
          kind: 'SALE',
        },
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

      // ISO datetimes expand to their containing Dhaka days (see above).
      const params = prisma.$queryRawUnsafe.mock.calls[0].slice(1);
      expect(params).toEqual([
        new Date('2025-05-31T18:00:00.000Z'),
        new Date('2025-06-16T17:59:59.999Z'),
      ]);
    });

    it('lifecycle query deduplicates orders across sources and repeated transitions', async () => {
      mockAll({});

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      // DISTINCT order_id for every metric → no double counting from
      // multiple dispatches or Confirmed→Hold→Confirmed cycles. The
      // aggregation is a per-status GROUP BY (not per-status FILTER columns),
      // so every configured status is covered in one pass.
      expect(sql).toContain('COUNT(DISTINCT order_id)');
      expect(sql).toMatch(/GROUP BY status/);
      // Both event sources are unioned: timeline transitions and the
      // dispatch pickup/delivery events. The dispatch/courier literal forms
      // still appear — inside the CASE that normalizes them onto the
      // canonical status names before GROUP BY (see the normalization test).
      expect(sql).toMatch(/'PICKED_UP'/);
      expect(sql).toMatch(/'DELIVERED'/);
    });

    // ── REGRESSION: Activity Delivered double-count ─────────────────
    // A normal delivery writes BOTH a timeline 'Delivered' entry and a
    // dispatch row with deliveredAt. The old code grouped by raw spelling
    // and SUMMED the two groups, so one delivered order counted twice;
    // Shipping used a Math.max heuristic that under-counted whenever the
    // two sources covered different orders. The fix normalizes statuses
    // in SQL and counts DISTINCT order_id per canonical status (exact
    // union), and the folding method below is a straight lookup.
    it('normalizes dispatch/courier literal statuses to canonical names in the lifecycle query', async () => {
      mockAll({});

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      expect(sql).toContain(`WHEN e->>'status' = 'DELIVERED' THEN 'Delivered'`);
      expect(sql).toContain(`WHEN e->>'status' = 'PICKED_UP' THEN 'Shipping'`);
      // Dispatch branches emit the canonical names directly.
      expect(sql).toContain(`SELECT d."orderId", 'Shipping'`);
      expect(sql).toContain(`SELECT d."orderId", 'Delivered'`);
    });

    it('applies the SALE kind filter to the dispatch branches, not only the timeline branch', async () => {
      mockAll({});

      await service.getOperationalKpis('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      // One occurrence per branch: timeline + pickup dispatch + delivery
      // dispatch. Return/exchange orders must never inflate sale counts.
      expect((sql.match(/o\."kind" = 'SALE'/g) || []).length).toBe(3);
    });

    it('counts one delivered order exactly once (no sum across spellings, no max heuristic)', async () => {
      // Rows exactly as the normalized query produces them: a single
      // 'Delivered' group already holding the exact union of timeline +
      // dispatch deliveries. The old sum would have needed two groups to
      // double-count; the old max would have hidden the union for Shipping.
      mockAll({
        statusEvents: [
          { status: 'Shipping', orders: 7 },
          { status: 'Delivered', orders: 5 },
        ],
      });

      const result = await service.getOperationalKpis(
        '2025-06-01',
        '2025-06-15',
      );

      expect(result.delivered).toBe(5);
      expect(result.pickedUp).toBe(7);
    });

    it('never sums separate literal-form rows into Delivered', async () => {
      // Literal-form rows cannot occur in production (the query normalizes
      // them), but if one ever slips through it must NOT be added to the
      // canonical count — the sum was the double-count bug.
      mockAll({
        statusEvents: [
          { status: 'Delivered', orders: 2 },
          { status: 'DELIVERED', orders: 1 },
          { status: 'PICKED_UP', orders: 3 },
        ],
      });

      const result = await service.getOperationalKpis(
        '2025-06-01',
        '2025-06-15',
      );

      expect(result.delivered).toBe(2);
      expect(result.pickedUp).toBe(0);
      expect(
        result.statusCounts.some(
          (s) => s.name === 'DELIVERED' || s.name === 'PICKED_UP',
        ),
      ).toBe(false);
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

      // ISO datetimes expand to their containing Dhaka days (see above).
      expect(prisma.payment.aggregate).toHaveBeenCalledWith({
        _sum: { amount: true },
        where: {
          status: 'PAID',
          createdAt: {
            gte: new Date('2025-05-31T18:00:00.000Z'),
            lte: new Date('2025-06-16T17:59:59.999Z'),
          },
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
      // The Payment table is now aliased (`p`) so the query can join Order and
      // exclude non-sale kinds — the UTC pinning itself is unchanged.
      expect(sql).toContain(`(p."createdAt" AT TIME ZONE 'UTC')`);
    });

    // A return/exchange order's payment must never be reported as revenue
    // next to the sale it was derived from.
    it('getRevenueByPaymentMethod excludes non-sale order kinds', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getRevenueByPaymentMethod('2025-06-01', '2025-06-15');

      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      expect(sql).toContain(`o."kind" = 'SALE'`);
    });
  });

  describe('getOperationalPipelineKpis', () => {
    const STATUSES = [
      { id: 'st-confirmed', name: 'Confirmed', color: '#3B82F6', sortOrder: 0 },
      { id: 'st-packed', name: 'Packed', color: '#059669', sortOrder: 1 },
      { id: 'st-shipping', name: 'Shipping', color: '#06B6D4', sortOrder: 2 },
      { id: 'st-delivered', name: 'Delivered', color: '#10B981', sortOrder: 3 },
      { id: 'st-hold', name: 'Hold', color: '#D97706', sortOrder: 4 },
      { id: 'st-cancelled', name: 'Cancelled', color: '#EF4444', sortOrder: 5 },
      { id: 'st-pending', name: 'Pending', color: '#F59E0B', sortOrder: 6 },
      { id: 'st-packing-hold', name: 'Packing Hold', color: '#D97706', sortOrder: 7 },
    ];

    /** Cohort: 20 orders created in period, mixed current statuses. */
    function mockPipeline() {
      prisma.order.count.mockResolvedValue(20);
      prisma.order.groupBy.mockResolvedValue([
        { statusId: 'st-confirmed', _count: 5 },
        { statusId: 'st-packed', _count: 3 },
        { statusId: 'st-shipping', _count: 4 },
        { statusId: 'st-delivered', _count: 6 },
        { statusId: 'st-hold', _count: 1 },
        { statusId: 'st-cancelled', _count: 1 },
      ]);
      prisma.orderStatus.findMany.mockResolvedValue(STATUSES);
      prisma.payment.count.mockResolvedValue(7);
      prisma.refund.count.mockResolvedValue(2);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 75000 } });
    }

    it('returns cohort current-status distribution in the OperationalKpi shape', async () => {
      mockPipeline();

      const result = await service.getOperationalPipelineKpis(
        '2025-06-01',
        '2025-06-15',
      );

      expect(result).toEqual({
        newOrders: 20,
        confirmed: 5,
        packed: 3,
        pickedUp: 4, // currently in Shipping
        delivered: 6,
        pendingPayments: 7,
        pendingRefunds: 2,
        revenue: 75000,
        // One entry per configured status, lifecycle order — including the
        // ones with no cohort orders (the client hides those).
        statusCounts: STATUSES.map((s) => ({
          name: s.name,
          count:
            s.id === 'st-confirmed'
              ? 5
              : s.id === 'st-packed'
                ? 3
                : s.id === 'st-shipping'
                  ? 4
                  : s.id === 'st-delivered'
                    ? 6
                    : s.id === 'st-hold'
                      ? 1
                      : s.id === 'st-cancelled'
                        ? 1
                        : 0,
          color: s.color,
          sortOrder: s.sortOrder,
        })),
      });
    });

    it('counts New Orders by cohort createdAt within the period, excluding trashed', async () => {
      mockPipeline();
      const start = new Date('2025-05-31T18:00:00.000Z');
      const end = new Date('2025-06-15T17:59:59.999Z');

      await service.getOperationalPipelineKpis(
        start.toISOString(),
        end.toISOString(),
      );

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { createdAt: { gte: start, lte: end }, trashedAt: null, kind: 'SALE' },
      });
    });

    it('scopes the status group-by to the same cohort (createdAt + non-trashed)', async () => {
      mockPipeline();
      const start = new Date('2025-05-31T18:00:00.000Z');
      const end = new Date('2025-06-15T17:59:59.999Z');

      await service.getOperationalPipelineKpis(
        start.toISOString(),
        end.toISOString(),
      );

      expect(prisma.order.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['statusId'],
          where: { createdAt: { gte: start, lte: end }, trashedAt: null, kind: 'SALE' },
        }),
      );
    });

    it('maps Shipping to pickedUp and excludes non-lifecycle statuses from tiles', async () => {
      mockPipeline();

      const result = await service.getOperationalPipelineKpis(
        '2025-06-01',
        '2025-06-15',
      );

      // Hold (1) + Cancelled (1) counted in newOrders (20) but in no tile:
      // tile sum (18) < cohort total is expected, not a bug.
      expect(result.pickedUp).toBe(4);
      expect(result.confirmed + result.packed + result.pickedUp + result.delivered).toBe(18);
      expect(result.newOrders).toBe(20);
    });

    it('does not count Packing Hold as Packed (exact status-name match)', async () => {
      mockPipeline();
      prisma.order.groupBy.mockResolvedValue([
        { statusId: 'st-packing-hold', _count: 2 },
        { statusId: 'st-pending', _count: 3 },
      ]);

      const result = await service.getOperationalPipelineKpis(
        '2025-06-01',
        '2025-06-15',
      );

      expect(result.packed).toBe(0);
      expect(result.confirmed).toBe(0);
    });

    it('keeps snapshot semantics identical to Activity (backlog + payment-event revenue)', async () => {
      mockPipeline();
      const start = new Date('2025-05-31T18:00:00.000Z');
      const end = new Date('2025-06-15T17:59:59.999Z');

      await service.getOperationalPipelineKpis(
        start.toISOString(),
        end.toISOString(),
      );

      expect(prisma.payment.count).toHaveBeenCalledWith({
        where: { status: 'PENDING' },
      });
      expect(prisma.refund.count).toHaveBeenCalledWith({
        where: { status: 'pending' },
      });
      expect(prisma.payment.aggregate).toHaveBeenCalledWith({
        _sum: { amount: true },
        where: { status: 'PAID', createdAt: { gte: start, lte: end } },
      });
    });

    it('wraps database failures in an InternalServerErrorException', async () => {
      prisma.order.count.mockRejectedValue(new Error('db down'));

      await expect(
        service.getOperationalPipelineKpis('2025-06-01', '2025-06-15'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('P2 invariants I1–I6 (dashboard-counts audit §6, seeded day)', () => {
    /**
     * Seeded Dhaka day 2026-11-13 — adapted from audit §6. (The audit's
     * own §6 pattern does not reconcile: 30+2+3+2+4+2+1+1(WC) = 45, not
     * 46, and a WC order consumes NO counter. This seed is defined to
     * reconcile exactly, and the counter half lives in
     * counter-reconciliation.spec.ts.)
     *
     * Orders created that day: 30 web SALE (5 still Pending, 25 across
     * Confirmed/Packed/Shipping/Delivered/Cancelled) + 3 POS SALE
     * (Confirmed) + 1 imported WC SALE (Confirmed) + 2 trashed SALE +
     * 2 exchange children (kind EXCHANGE). Failed web creates: 4 (burned
     * ORD numbers — counter half). JE 2, EXP-JE 1, EMP 1 (counter half).
     *
     * Therefore: Activity New = Pipeline Total = 30 + 3 + 1 = 34
     * (POS and WC orders ARE kind SALE and count — audit §1c), Pipeline
     * Pending = 5, Pipeline tiles sum to 34.
     */
    const DAY_START = new Date('2026-11-12T18:00:00.000Z'); // 00:00 Dhaka 11-13
    const DAY_END = new Date('2026-11-13T17:59:59.999Z'); // 23:59:59.999 Dhaka
    const PIPELINE_STATUSES = [
      { id: 'st-pending', name: 'Pending', color: '#F59E0B', sortOrder: 0 },
      { id: 'st-confirmed', name: 'Confirmed', color: '#3B82F6', sortOrder: 1 },
      { id: 'st-packed', name: 'Packed', color: '#059669', sortOrder: 2 },
      { id: 'st-shipping', name: 'Shipping', color: '#06B6D4', sortOrder: 3 },
      { id: 'st-delivered', name: 'Delivered', color: '#10B981', sortOrder: 4 },
      { id: 'st-cancelled', name: 'Cancelled', color: '#EF4444', sortOrder: 5 },
    ];
    // Current-status distribution of the 34-order cohort: 5+13+3+6+5+2 = 34.
    const COHORT_GROUPS = [
      { statusId: 'st-pending', _count: 5 },
      { statusId: 'st-confirmed', _count: 13 },
      { statusId: 'st-packed', _count: 3 },
      { statusId: 'st-shipping', _count: 6 },
      { statusId: 'st-delivered', _count: 5 },
      { statusId: 'st-cancelled', _count: 2 },
    ];

    function mockSeededDay() {
      prisma.order.count.mockResolvedValue(34);
      prisma.$queryRawUnsafe.mockResolvedValue([
        { status: 'Confirmed', orders: 12 },
        { status: 'Packed', orders: 3 },
        { status: 'Shipping', orders: 6 },
        { status: 'Delivered', orders: 5 },
      ]);
      prisma.order.groupBy.mockResolvedValue(COHORT_GROUPS);
      prisma.orderStatus.findMany.mockResolvedValue(PIPELINE_STATUSES);
      prisma.payment.count.mockResolvedValue(0);
      prisma.refund.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    }

    it('I1 — Activity New == count(SALE created in day, not trashed)', async () => {
      mockSeededDay();

      const result = await service.getOperationalKpis(
        '2026-11-13',
        '2026-11-13',
      );

      expect(result.newOrders).toBe(34);
      expect(prisma.order.count).toHaveBeenCalledWith({
        where: {
          createdAt: { gte: DAY_START, lte: DAY_END },
          trashedAt: null,
          kind: 'SALE',
        },
      });
      // The query never reads the timeline: the 2 trashed SALE orders and
      // the 2 EXCHANGE children are excluded by trashedAt/kind, not by
      // any event — so a SALE order created in a non-Pending initial
      // status, or later Cancelled, still counts.
    });

    it('I2 — Pipeline tiles sum to Pipeline Total (each cohort order once)', async () => {
      mockSeededDay();

      const result = await service.getOperationalPipelineKpis(
        '2026-11-13',
        '2026-11-13',
      );

      expect(result.newOrders).toBe(34);
      const tileSum = result.statusCounts.reduce((s, t) => s + t.count, 0);
      expect(tileSum).toBe(result.newOrders);
      expect(prisma.order.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['statusId'],
          where: {
            createdAt: { gte: DAY_START, lte: DAY_END },
            trashedAt: null,
            kind: 'SALE',
          },
        }),
      );
    });

    it('I3 — Pipeline Pending <= Activity New and == period-created currently-Pending', async () => {
      mockSeededDay();

      const activity = await service.getOperationalKpis(
        '2026-11-13',
        '2026-11-13',
      );
      const pipeline = await service.getOperationalPipelineKpis(
        '2026-11-13',
        '2026-11-13',
      );

      const pendingTile = pipeline.statusCounts.find(
        (t) => t.name === 'Pending',
      );
      expect(pendingTile?.count).toBe(5);
      expect(pendingTile!.count).toBeLessThanOrEqual(activity.newOrders);
      // The two "New Orders" numbers are DIFFERENT facts: Activity counts
      // creations (34), Pipeline counts the cohort still Pending (5).
      expect(activity.newOrders).not.toBe(pendingTile!.count);
    });

    it('I5 — no double-count: Delivered via timeline AND dispatch counts once', async () => {
      mockSeededDay();

      const result = await service.getOperationalKpis(
        '2026-11-13',
        '2026-11-13',
      );

      // One order holding BOTH a timeline Delivered event and a dispatch
      // deliveredAt still contributes exactly one Delivered event row
      // (the SQL dedupes with COUNT(DISTINCT order_id) before GROUP BY).
      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      expect(sql).toContain('COUNT(DISTINCT order_id)');
      expect(sql).toMatch(/GROUP BY status/);
      expect(result.delivered).toBe(5);
    });

    it('I6 — Activity and Pipeline are distinct endpoints with distinct semantics', async () => {
      mockSeededDay();

      const activity = await service.getOperationalKpis(
        '2026-11-13',
        '2026-11-13',
      );
      const pipeline = await service.getOperationalPipelineKpis(
        '2026-11-13',
        '2026-11-13',
      );

      // Same period, same cohort — but the Pending tile differs by design:
      // Activity Pending is the creation count (34), Pipeline Pending is
      // the cohort's current state (5). A UI placing them side by side
      // must label which is which (per-tile basis strings are the admin
      // agent's part of I6; the backend locks the semantic split here).
      const activityPending = activity.statusCounts.find(
        (t) => t.name === 'Pending',
      );
      const pipelinePending = pipeline.statusCounts.find(
        (t) => t.name === 'Pending',
      );
      expect(activityPending?.count).toBe(34);
      expect(pipelinePending?.count).toBe(5);
    });

    it('locks the 8 counting principles as the service doc comment', async () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '..', 'dashboard.service.ts'),
        'utf8',
      );
      expect(src).toContain('COUNTING PRINCIPLES');
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
        expect(src).toContain(` ${n}. `);
      }
      expect(src).toContain('Sequence numbers are document numbers');
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
