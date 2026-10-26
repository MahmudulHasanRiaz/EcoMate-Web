import { DashboardService } from '../dashboard.service';

/**
 * Operational KPI status distribution (§ Activity & Pipeline):
 * both views must return one entry per CONFIGURED `OrderStatus`, ordered by
 * `sortOrder`, so the panel can render a card per status and hide the empty
 * ones itself.
 */

/** The seeded order statuses, in lifecycle order. */
const STATUSES = [
  { id: 'st-pending', name: 'Pending', color: '#F59E0B', sortOrder: 0 },
  { id: 'st-paypend', name: 'Payment Pending', color: '#F59E0B', sortOrder: 1 },
  { id: 'st-payver', name: 'Payment Verifying', color: '#8B5CF6', sortOrder: 2 },
  { id: 'st-hold', name: 'Hold', color: '#D97706', sortOrder: 3 },
  { id: 'st-conf', name: 'Confirmed', color: '#3B82F6', sortOrder: 4 },
  { id: 'st-packed', name: 'Packed', color: '#059669', sortOrder: 5 },
  { id: 'st-packhold', name: 'Packing Hold', color: '#D97706', sortOrder: 6 },
  { id: 'st-ship', name: 'Shipping', color: '#06B6D4', sortOrder: 7 },
  { id: 'st-deliv', name: 'Delivered', color: '#10B981', sortOrder: 8 },
  { id: 'st-partial', name: 'Partial', color: '#F59E0B', sortOrder: 9 },
  { id: 'st-retpend', name: 'Return Pending', color: '#EC4899', sortOrder: 10 },
  { id: 'st-ret', name: 'Returned', color: '#DC2626', sortOrder: 11 },
  { id: 'st-dam', name: 'Damaged', color: '#991B1B', sortOrder: 12 },
  { id: 'st-cancel', name: 'Cancelled', color: '#EF4444', sortOrder: 13 },
];

function makeService(over: {
  groups?: Array<{ statusId: string; _count: number }>;
  statusEventRows?: Array<{ status: string | null; orders: number }>;
  newOrders?: number;
} = {}) {
  const prisma: any = {
    order: {
      count: jest.fn().mockResolvedValue(over.newOrders ?? 0),
      groupBy: jest.fn().mockResolvedValue(over.groups ?? []),
    },
    orderStatus: { findMany: jest.fn().mockResolvedValue(STATUSES) },
    payment: { count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
    refund: { count: jest.fn().mockResolvedValue(0) },
    // One raw query: the per-status event GROUP BY.
    $queryRawUnsafe: jest.fn().mockResolvedValue(over.statusEventRows ?? []),
  };
  const service = new DashboardService(prisma);
  return { service, prisma };
}

describe('DashboardService — operational status distribution', () => {
  describe('Pipeline (cohort current state)', () => {
    it('returns one entry per configured status, ordered by sortOrder', async () => {
      const { service } = makeService({
        groups: [
          { statusId: 'st-conf', _count: 5 },
          { statusId: 'st-deliv', _count: 3 },
        ],
      });

      const res = await service.getOperationalPipelineKpis();

      expect(res.statusCounts).toHaveLength(STATUSES.length);
      expect(res.statusCounts.map((s) => s.name)).toEqual(
        STATUSES.map((s) => s.name),
      );
      expect(res.statusCounts.map((s) => s.sortOrder)).toEqual(
        STATUSES.map((s) => s.sortOrder),
      );
      // Statuses with no orders are present with a zero count (the client
      // decides to hide them) — never silently dropped.
      expect(res.statusCounts.find((s) => s.name === 'Confirmed')?.count).toBe(5);
      expect(res.statusCounts.find((s) => s.name === 'Delivered')?.count).toBe(3);
      expect(res.statusCounts.find((s) => s.name === 'Damaged')?.count).toBe(0);
    });

    it('carries the status colour through for tile accents', async () => {
      const { service } = makeService();
      const res = await service.getOperationalPipelineKpis();

      expect(res.statusCounts.find((s) => s.name === 'Cancelled')?.color).toBe('#EF4444');
    });

    it('keeps the legacy fixed fields consistent with the distribution', async () => {
      const { service } = makeService({
        groups: [
          { statusId: 'st-conf', _count: 7 },
          { statusId: 'st-packed', _count: 4 },
          { statusId: 'st-ship', _count: 6 },
          { statusId: 'st-deliv', _count: 2 },
        ],
      });

      const res = await service.getOperationalPipelineKpis();

      expect(res.confirmed).toBe(7);
      expect(res.packed).toBe(4);
      expect(res.pickedUp).toBe(6);
      expect(res.delivered).toBe(2);
    });

    it('reports zero (not undefined) for statuses with no orders', async () => {
      const { service } = makeService({ groups: [] });
      const res = await service.getOperationalPipelineKpis();

      expect(res.confirmed).toBe(0);
      expect(res.pickedUp).toBe(0);
      expect(res.statusCounts.every((s) => s.count === 0)).toBe(true);
    });
  });

  describe('Activity (transition events in period)', () => {
    it('reports distinct orders that entered each status', async () => {
      const { service } = makeService({
        newOrders: 12,
        statusEventRows: [
          { status: 'Confirmed', orders: 8 },
          { status: 'Packed', orders: 6 },
          { status: 'Shipping', orders: 5 },
          { status: 'Delivered', orders: 4 },
          { status: 'Cancelled', orders: 2 },
          { status: 'Payment Verifying', orders: 1 },
        ],
      });

      const res = await service.getOperationalKpis();
      const byName = Object.fromEntries(res.statusCounts.map((s) => [s.name, s.count]));

      expect(byName.Confirmed).toBe(8);
      expect(byName.Packed).toBe(6);
      expect(byName.Shipping).toBe(5);
      expect(byName.Delivered).toBe(4);
      expect(byName.Cancelled).toBe(2);
      expect(byName['Payment Verifying']).toBe(1);
      // No events for these in the period.
      expect(byName.Damaged).toBe(0);
      expect(byName.Partial).toBe(0);
    });

    it('uses the period creation count for Pending (not a transition event)', async () => {
      const { service } = makeService({
        newOrders: 42,
        statusEventRows: [{ status: 'Pending', orders: 3 }],
      });

      const res = await service.getOperationalKpis();

      expect(res.statusCounts.find((s) => s.name === 'Pending')?.count).toBe(42);
    });

    it('counts each order once per canonical status — folding moved into SQL', async () => {
      // Courier paths stamp Dispatch timestamps instead of writing a timeline
      // entry. The lifecycle query now normalizes those literals onto the
      // canonical names ('PICKED_UP' → 'Shipping', 'DELIVERED' →
      // 'Delivered') BEFORE GROUP BY and counts DISTINCT order_id, so by
      // the time rows reach this method one delivered order is already
      // exactly one Delivered — even when it has both a timeline entry and
      // a dispatch row. The old TypeScript sum (Delivered + DELIVERED) and
      // Math.max (Shipping vs PICKED_UP) are gone: the sum double-counted,
      // the max under-counted.
      const { service, prisma } = makeService({
        newOrders: 10,
        statusEventRows: [
          { status: 'Shipping', orders: 4 },
          { status: 'Delivered', orders: 3 },
        ],
      });

      const res = await service.getOperationalKpis();
      const byName = Object.fromEntries(res.statusCounts.map((s) => [s.name, s.count]));

      expect(byName.Shipping).toBe(4);
      expect(byName.Delivered).toBe(3);
      // No phantom literal-form status in the output.
      expect(res.statusCounts.some((s) => s.name === 'PICKED_UP')).toBe(false);
      expect(res.statusCounts.some((s) => s.name === 'DELIVERED')).toBe(false);
      // And the query itself performs the normalization.
      const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
      expect(sql).toContain(`WHEN e->>'status' = 'DELIVERED' THEN 'Delivered'`);
      expect(sql).toContain(`WHEN e->>'status' = 'PICKED_UP' THEN 'Shipping'`);
    });

    it('returns every configured status, in lifecycle order, with zeros', async () => {
      const { service } = makeService({ newOrders: 1, statusEventRows: [] });
      const res = await service.getOperationalKpis();

      expect(res.statusCounts).toHaveLength(STATUSES.length);
      expect(res.statusCounts.map((s) => s.name)).toEqual(STATUSES.map((s) => s.name));
    });

    it('ignores null status rows (timeline entries without a status key)', async () => {
      const { service } = makeService({
        newOrders: 3,
        statusEventRows: [
          { status: null, orders: 9 },
          { status: 'Confirmed', orders: 2 },
        ],
      });

      const res = await service.getOperationalKpis();

      expect(res.statusCounts).toHaveLength(STATUSES.length);
      expect(res.statusCounts.find((s) => s.name === 'Confirmed')?.count).toBe(2);
    });
  });
});
