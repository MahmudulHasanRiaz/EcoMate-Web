import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SALE_ORDER_KIND, SALE_ORDER_SQL_FILTER, saleOrderOnlyWhere } from '../orders/order-scope';
import { dhakaDayRange, endOfDhakaDay, startOfDhakaDay } from '../common/utils/dhaka-time';

/**
 * One order-status tile: how many orders sit in (Pipeline) or entered
 * (Activity) this status for the selected period.
 *
 * Both operational KPI views return one entry per CONFIGURED `OrderStatus`,
 * ordered by `sortOrder` — including statuses with no orders, so the client
 * can hide zero cards without needing the status catalogue of its own.
 */
export interface StatusCount {
  name: string;
  count: number;
  color: string;
  sortOrder: number;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  private dateFilter(
    startDate?: string,
    endDate?: string,
  ): { createdAt?: { gte?: Date; lte?: Date } } {
    if (!startDate && !endDate) return {};
    const filter: { gte?: Date; lte?: Date } = {};
    if (startDate) filter.gte = dhakaDayRange(startDate).start ?? undefined;
    if (endDate) filter.lte = dhakaDayRange(endDate).end ?? undefined;
    return { createdAt: filter };
  }

  private getDateRange(startDate?: string, endDate?: string) {
    const start = startDate ? dhakaDayRange(startDate).start : null;
    const end = endDate ? dhakaDayRange(endDate).end : null;
    return { start, end };
  }

  async getStats(startDate?: string, endDate?: string) {
    try {
      const dateFilter = this.dateFilter(startDate, endDate);
      const [
        totalOrders,
        revenueAgg,
        totalCustomers,
        totalProducts,
        recentOrders,
      ] = await Promise.all([
        this.prisma.order.count({ where: { ...dateFilter, trashedAt: null, ...saleOrderOnlyWhere() } }),
        this.prisma.payment.aggregate({
          _sum: { amount: true },
          // PAID only: this previously summed every payment status, so
          // uncollected/pending money was reported as revenue. Nested under the
          // order so a non-sale order's payments can never count either.
          where: { ...dateFilter, status: 'PAID', order: { kind: SALE_ORDER_KIND } },
        }),
        this.prisma.userProfile.count({ where: { role: 'customer' } }),
        this.prisma.product.count({ where: { isActive: true } }),
        this.prisma.order.findMany({
          where: { ...dateFilter, trashedAt: null, ...saleOrderOnlyWhere() },
          take: 20,
          orderBy: { createdAt: 'desc' },
          include: { status: true, _count: { select: { items: true } } },
        }),
      ]);

      return {
        totalRevenue: Number(revenueAgg._sum.amount || 0),
        totalOrders,
        totalCustomers,
        totalProducts,
        recentOrders: recentOrders.map((o) => ({
          id: o.id,
          displayId: o.displayId,
          total: Number(o.total),
          status: o.status.name,
          itemCount: o._count.items,
          createdAt: o.createdAt,
        })),
      };
    } catch (error) {
      this.logger.error(
        `getStats failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to fetch dashboard stats');
    }
  }

  async getAnalytics(startDate?: string, endDate?: string) {
    try {
      const effectiveDateFilter =
        startDate || endDate
          ? this.dateFilter(startDate, endDate)
          : {
              createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              },
            };

      const [ordersLast30Days, revenueLast30Days, pageViewCount] =
        await Promise.all([
          this.prisma.order.count({ where: { ...effectiveDateFilter, trashedAt: null, kind: 'SALE' } }),
          this.prisma.payment.aggregate({
            _sum: { amount: true },
            where: { ...effectiveDateFilter, status: 'PAID' },
          }),
          this.prisma.pageView.count({
            where: {
              timestamp: effectiveDateFilter.createdAt
                ? {
                    gte: effectiveDateFilter.createdAt.gte,
                    lte: effectiveDateFilter.createdAt.lte,
                  }
                : { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
          }),
        ]);

      return {
        ordersLast30Days,
        revenueLast30Days: Number(revenueLast30Days._sum.amount || 0),
        totalClicks: pageViewCount,
        uniqueVisitors: 0,
        bounceRate: '0%',
      };
    } catch (error) {
      this.logger.error(
        `getAnalytics failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to fetch analytics');
    }
  }

  async getPendingOrders(startDate?: string, endDate?: string) {
    try {
      const orders = await this.prisma.order.findMany({
        where: {
          ...this.dateFilter(startDate, endDate),
          trashedAt: null,
          // Pre-confirmation statuses awaiting action — including the
          // call-center pair (Recall = called once, No Response = retry also
          // unanswered); both exit via Confirmed or Cancelled like the rest.
          status: {
            name: {
              in: ['Pending', 'Payment Pending', 'Recall', 'No Response'],
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          status: true,
          _count: { select: { items: true } },
        },
      });
      return orders.map((o) => ({
        id: o.id,
        displayId: o.displayId,
        total: Number(o.total),
        status: o.status.name,
        // Use order-time snapshot for historical customer data
        customerName: [o.customerFirstName, o.customerLastName].filter(Boolean).join(' ') || o.guestName || 'Unknown',
        customerPhone: o.customerPhone || o.guestPhone || '',
        itemCount: o._count.items,
        createdAt: o.createdAt,
      }));
    } catch (error) {
      this.logger.error(
        `getPendingOrders failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to fetch pending orders');
    }
  }

  async getLowStockProducts() {
    try {
      type LowStockRow = {
        id: string;
        name: string;
        slug: string;
        sku: string | null;
        stock: number;
        lowStockQty: number | null;
        images: string | null;
      };

      const countResult = await this.prisma.$queryRawUnsafe<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count FROM "Product" WHERE "manageStock" = true AND "stock" <= COALESCE("lowStockQty", 0)`,
      );
      const rows = await this.prisma.$queryRawUnsafe<LowStockRow[]>(
        `SELECT id, name, slug, sku, stock, "lowStockQty", images::text AS images
         FROM "Product"
         WHERE "manageStock" = true AND "stock" <= COALESCE("lowStockQty", 0)
         ORDER BY "stock" ASC
         LIMIT 20`,
      );

      return {
        count: countResult[0]?.count ?? 0,
        products: rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          sku: r.sku,
          stock: r.stock,
          lowStockQty: r.lowStockQty,
          images: r.images ? JSON.parse(r.images) : [],
        })),
      };
    } catch (error) {
      this.logger.error(
        `getLowStockProducts failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to fetch low stock products',
      );
    }
  }

  async getTopProducts(startDate?: string, endDate?: string, limit = 10) {
    try {
      const safeLimit = Math.max(1, Math.min(100, limit));
      const { start, end } = this.getDateRange(startDate, endDate);

      type TopProductRow = {
        id: string;
        name: string;
        image: string;
        quantity: number;
      };

      const rows = await this.prisma.$queryRawUnsafe<TopProductRow[]>(
        `SELECT oi."productId" AS id,
                p.name,
                COALESCE(NULLIF(p.images::json->>0, ''), '') AS image,
                SUM(oi.quantity)::int AS quantity
         FROM "OrderItem" oi
         INNER JOIN "Order" o ON o.id = oi."orderId" AND o."trashedAt" IS NULL
         INNER JOIN "Product" p ON p.id = oi."productId"
         WHERE oi."productId" IS NOT NULL
           AND ($1::timestamp IS NULL OR (o."createdAt" AT TIME ZONE 'UTC') >= ($1::timestamp AT TIME ZONE 'UTC'))
           AND ($2::timestamp IS NULL OR (o."createdAt" AT TIME ZONE 'UTC') <= ($2::timestamp AT TIME ZONE 'UTC'))
         GROUP BY oi."productId", p.name, p.images
         ORDER BY quantity DESC
         LIMIT $3::int`,
        start,
        end,
        safeLimit,
      );

      return rows.map((r) => ({ ...r, image: r.image || '' }));
    } catch (error) {
      this.logger.error(
        `getTopProducts failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to fetch top products');
    }
  }

  async getOrderStatusDistribution(startDate?: string, endDate?: string) {
    try {
      const orders = await this.prisma.order.groupBy({
        by: ['statusId'],
        _count: true,
        _sum: { total: true },
        where: { ...this.dateFilter(startDate, endDate), trashedAt: null, kind: 'SALE' },
      });
      const statuses = await this.prisma.orderStatus.findMany();
      const statusMap = new Map(statuses.map((s) => [s.id, s.name]));
      return orders.map((o) => ({
        status: statusMap.get(o.statusId) || 'Unknown',
        count: o._count,
        totalAmount: Number(o._sum.total || 0),
      }));
    } catch (error) {
      this.logger.error(
        `getOrderStatusDistribution failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to fetch order status distribution',
      );
    }
  }

  async getRevenueByPaymentMethod(startDate?: string, endDate?: string) {
    try {
      const { start, end } = this.getDateRange(startDate, endDate);

      type RevenueRow = { method: string; revenue: string };

      const rows = await this.prisma.$queryRawUnsafe<RevenueRow[]>(
        `SELECT COALESCE(p."gatewayCode", 'unknown') AS method,
                SUM(p.amount)::text AS revenue
         FROM "Payment" p
         JOIN "Order" o ON o.id = p."orderId"
         WHERE p.status = 'PAID'
           AND ${SALE_ORDER_SQL_FILTER}
           AND ($1::timestamp IS NULL OR (p."createdAt" AT TIME ZONE 'UTC') >= ($1::timestamp AT TIME ZONE 'UTC'))
           AND ($2::timestamp IS NULL OR (p."createdAt" AT TIME ZONE 'UTC') <= ($2::timestamp AT TIME ZONE 'UTC'))
         GROUP BY p."gatewayCode"`,
        start,
        end,
      );

      return rows.map((r) => ({
        method: r.method,
        revenue: Number(r.revenue),
      }));
    } catch (error) {
      this.logger.error(
        `getRevenueByPaymentMethod failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to fetch revenue by payment method',
      );
    }
  }

  async getNewCustomers(startDate?: string, endDate?: string) {
    try {
      return this.prisma.userProfile.findMany({
        where: { ...this.dateFilter(startDate, endDate), role: 'customer' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          createdAt: true,
        },
      });
    } catch (error) {
      this.logger.error(
        `getNewCustomers failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to fetch new customers');
    }
  }

  async getPendingRefunds() {
    try {
      return this.prisma.refund.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { order: { select: { displayId: true } } },
      });
    } catch (error) {
      this.logger.error(
        `getPendingRefunds failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to fetch pending refunds');
    }
  }

  async getPendingDispatch() {
    try {
      return this.prisma.order.findMany({
        where: { status: { name: 'Confirmed' }, trashedAt: null },
        take: 10,
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      this.logger.error(
        `getPendingDispatch failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to fetch pending dispatch',
      );
    }
  }

  async getPendingPayments() {
    try {
      return this.prisma.payment.findMany({
        where: { status: 'PENDING' },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { order: { select: { displayId: true } } },
      });
    } catch (error) {
      this.logger.error(
        `getPendingPayments failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to fetch pending payments',
      );
    }
  }

  async getTodayKpi() {
    // Backward-compatible alias: delegates to period-aware implementation
    // using today's Dhaka range so existing consumers keep working.
    const todayStart = startOfDhakaDay();
    const todayEnd = endOfDhakaDay();
    return this.getOperationalKpis(
      todayStart.toISOString(),
      todayEnd.toISOString(),
    );
  }

  async getOperationalKpis(startDate?: string, endDate?: string) {
    try {
      const { start, end } = this.getDateRange(startDate, endDate);
      // Resolve to non-null Date values (end falls back to now if no end).
      const periodStart = start ?? new Date(0);
      const periodEnd = end ?? new Date();
      const dateFilter = { gte: periodStart, lte: periodEnd };

      // ── New Orders ─────────────────────────────────────────────────────
      // Creation EVENT: orders created within the period (not trashed).
      // Uses the canonical indexed `createdAt` column.
      const newOrders = await this.prisma.order.count({
        where: { createdAt: dateFilter, trashedAt: null, kind: 'SALE' },
      });

      // ── Lifecycle events (Confirmed / Packed / Picked Up / Delivered) ──
      // These are TRANSITION counts, not "current status" counts: an order
      // created last month but delivered today counts in today's range, and
      // an order confirmed in range still counts after it later ships.
      //
      // Authoritative event sources (audited, see report):
      //  1. `Order.timeline` JSONB — every order-status transition written by
      //     OrdersService.updateStatus (manual staff, courier webhook advance,
      //     bulk transitions) as {status, oldStatus, timestamp, ...}, plus
      //     courier events from webhooks as {type:'courier', status:'PICKED_UP'
      //     |'DELIVERED', timestamp}. This is the only record that covers both
      //     manual and courier-driven progression.
      //  2. `Dispatch.pickedUpAt` / `Dispatch.deliveredAt` — set by the manual
      //     dispatch board, courier webhooks, AND courier sync. Any post-pickup
      //     dispatch status (IN_TRANSIT / ASSIGNED_TO_RIDER / DELIVERED /
      //     PARTIAL) stamps pickedUpAt when still null — courier paths often
      //     skip the explicit PICKED_UP transition. Historical nulls are
      //     backfilled by migration 20260924070009_backfill_picked_up_at.
      //
      // DISTINCT order_id across BOTH sources guarantees an order is counted
      // once even when it has multiple dispatches or repeated transitions
      // (e.g. Confirmed → Hold → Confirmed).
      type StatusEventRow = { status: string | null; orders: number };
      const statusEventRows = await this.prisma.$queryRawUnsafe<StatusEventRow[]>(
        `WITH period AS (
           -- Params arrive as timezone-less UTC wall clock (Prisma sends
           -- DateTime params that way). Casting them straight to timestamptz
           -- would make Postgres read them in the session timezone, shifting
           -- every boundary by the session offset. Pin them to UTC first.
           SELECT ($1::timestamp AT TIME ZONE 'UTC') AS range_start,
                  ($2::timestamp AT TIME ZONE 'UTC') AS range_end
         ),
         events AS (
           -- Statuses are NORMALIZED to one canonical form here, in SQL, so
           -- the GROUP BY below counts each order exactly once per status:
           -- a normal delivery writes BOTH a timeline 'Delivered' entry and
           -- a dispatch row with deliveredAt, and a pickup writes BOTH a
           -- timeline 'Shipping' entry and a dispatch pickedUpAt. Summing the
           -- two spellings afterwards (the old behaviour) double-counted
           -- every such order; taking the larger (the old Shipping
           -- heuristic) under-counted whenever the two sources covered
           -- different orders. COUNT(DISTINCT order_id) over the normalized
           -- status is the exact union of both sources.
           -- 1. Order lifecycle transitions recorded in the order timeline.
           --    Courier webhook entries use the literal forms 'PICKED_UP' /
           --    'DELIVERED'; every other timeline entry already carries the
           --    configured status name.
           SELECT o.id AS order_id,
                  CASE WHEN e->>'status' = 'DELIVERED' THEN 'Delivered'
                       WHEN e->>'status' = 'PICKED_UP' THEN 'Shipping'
                       ELSE e->>'status' END AS status
           FROM "Order" o
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.timeline::jsonb, '[]'::jsonb)) e
           CROSS JOIN period p
           WHERE o."trashedAt" IS NULL
             AND ${SALE_ORDER_SQL_FILTER}
             AND e ? 'timestamp'
             AND e->>'timestamp' ~ '^\\d{4}-\\d{2}-\\d{2}'
             AND (e->>'timestamp')::timestamptz BETWEEN p.range_start AND p.range_end
           UNION ALL
           -- 2a. Pickup event (manual dispatch board)
           --     Dispatch timestamp columns are timestamp-without-time-zone
           --     holding UTC wall clock (Prisma's DateTime convention), so they
           --     MUST be pinned to UTC before comparing against the timestamptz
           --     period bounds. Without this the comparison silently shifts by
           --     the session offset and disagrees with the timeline branch.
           --     Dispatch branches carry the SALE kind filter like the
           --     timeline branch: return/exchange orders must never inflate
           --     the sale lifecycle counts.
           SELECT d."orderId", 'Shipping'
           FROM "Dispatch" d
           JOIN "Order" o ON o.id = d."orderId" AND o."trashedAt" IS NULL
           CROSS JOIN period p
           WHERE ${SALE_ORDER_SQL_FILTER}
             AND (d."pickedUpAt" AT TIME ZONE 'UTC') BETWEEN p.range_start AND p.range_end
           UNION ALL
           -- 2b. Delivery event (manual dispatch board)
           SELECT d."orderId", 'Delivered'
           FROM "Dispatch" d
           JOIN "Order" o ON o.id = d."orderId" AND o."trashedAt" IS NULL
           CROSS JOIN period p
           WHERE ${SALE_ORDER_SQL_FILTER}
             AND (d."deliveredAt" AT TIME ZONE 'UTC') BETWEEN p.range_start AND p.range_end
         )
         -- One row per status instead of a fixed set of FILTER columns, so
         -- EVERY configured order status gets a count in a single pass.
         -- DISTINCT order_id keeps an order that entered/left a status twice
         -- (or has several dispatches) counted once.
         SELECT status, COUNT(DISTINCT order_id)::int AS orders
         FROM events
         WHERE status IS NOT NULL
         GROUP BY status`,
        periodStart,
        periodEnd,
      );

      // ── Pending Payments ───────────────────────────────────────────────
      // SEMANTICS: current outstanding backlog (NOT period-filtered).
      // Payment rows in PENDING status = online payments recorded but not yet
      // verified/completed — the actionable verification backlog. This mirrors
      // the existing pending-payments widget so both show the same number.
      // Deliberately excludes UNPAID (COD cash expected on delivery — not an
      // actionable pending item) and terminal states (PAID/FAILED/...).
      const pendingPayments = await this.prisma.payment.count({
        where: { status: 'PENDING' },
      });

      // ── Pending Refunds ────────────────────────────────────────────────
      // SEMANTICS: current outstanding backlog (NOT period-filtered).
      // 'pending' is the state the refunds board shows Approve/Reject for.
      const pendingRefunds = await this.prisma.refund.count({
        where: { status: 'pending' },
      });

      // ── Revenue ────────────────────────────────────────────────────────
      // Payment EVENT within the period: PAID payment rows dated by the
      // payment's own `createdAt` (payment date), never the order date.
      // The PAID gate excludes FAILED/CANCELLED and unpaid COD rows; a
      // reversed/refunded payment leaves PAID, so it drops out of revenue.
      const revenueAgg = await this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: 'PAID',
          createdAt: dateFilter,
        },
      });

      const statusCounts = await this.activityStatusCounts(
        statusEventRows ?? [],
        newOrders,
      );

      return {
        newOrders,
        // Legacy fixed fields (kept for existing consumers): read from the
        // SAME distribution the tiles use, so the two can never disagree.
        confirmed: this.countOf(statusCounts, 'Confirmed'),
        packed: this.countOf(statusCounts, 'Packed'),
        pickedUp: this.countOf(statusCounts, 'Shipping'),
        delivered: this.countOf(statusCounts, 'Delivered'),
        pendingPayments,
        pendingRefunds,
        revenue: Number(revenueAgg?._sum?.amount || 0),
        statusCounts,
      };
    } catch (error) {
      this.logger.error(
        `getOperationalKpis failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to fetch operational KPIs');
    }
  }

  async getOperationalPipelineKpis(startDate?: string, endDate?: string) {
    try {
      const { start, end } = this.getDateRange(startDate, endDate);
      // Same period resolution as Activity: start falls back to epoch,
      // end falls back to now.
      const periodStart = start ?? new Date(0);
      const periodEnd = end ?? new Date();
      const dateFilter = { gte: periodStart, lte: periodEnd };

      // ── Order Cohort ───────────────────────────────────────────────────
      // Total orders CREATED within the period (not trashed). The frontend
      // labels this "Order Cohort" — never "New Orders" — because it is a
      // cohort total, not a current "new" status.
      const newOrders = await this.prisma.order.count({
        where: { createdAt: dateFilter, trashedAt: null, kind: 'SALE' },
      });

      // ── Current-status distribution of the cohort ──────────────────────
      // Where the period-created orders stand NOW (single current status per
      // order). Every configured OrderStatus is reported (see
      // `cohortStatusCounts`), so the panel can render one card per status
      // instead of only the lifecycle subset.
      const statusCounts = await this.cohortStatusCounts(dateFilter);

      // ── Snapshots: identical semantics to Activity ─────────────────────
      // Pending Payments / Pending Refunds are global backlogs; revenue is
      // the PAID payment event within the period. Unchanged by design.
      const pendingPayments = await this.prisma.payment.count({
        where: { status: 'PENDING' },
      });
      const pendingRefunds = await this.prisma.refund.count({
        where: { status: 'pending' },
      });
      const revenueAgg = await this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: 'PAID',
          createdAt: dateFilter,
        },
      });

      return {
        newOrders,
        // Legacy fixed fields (kept for existing consumers): read straight
        // from the full distribution so the two can never disagree.
        confirmed: this.countOf(statusCounts, 'Confirmed'),
        packed: this.countOf(statusCounts, 'Packed'),
        pickedUp: this.countOf(statusCounts, 'Shipping'),
        delivered: this.countOf(statusCounts, 'Delivered'),
        pendingPayments,
        pendingRefunds,
        revenue: Number(revenueAgg?._sum?.amount || 0),
        statusCounts,
      };
    } catch (error) {
      this.logger.error(
        `getOperationalPipelineKpis failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to fetch operational pipeline KPIs',
      );
    }
  }

  /**
   * One tile per CONFIGURED OrderStatus, ordered by `sortOrder`, for the
   * period cohort's CURRENT state (single status per order).
   *
   * Every configured status is returned — including the ones with zero orders
   * — so the client decides what to render; `count` is a plain count here.
   */
  private async cohortStatusCounts(
    dateFilter: { gte: Date; lte: Date },
  ): Promise<StatusCount[]> {
    const [statuses, groups] = await Promise.all([
      this.prisma.orderStatus.findMany({
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, color: true, sortOrder: true },
      }),
      this.prisma.order.groupBy({
        by: ['statusId'],
        _count: true,
        where: { createdAt: dateFilter, trashedAt: null, kind: 'SALE' },
      }),
    ]);
    const countByStatus = new Map(groups.map((g) => [g.statusId, g._count]));
    return statuses.map((s) => ({
      name: s.name,
      count: countByStatus.get(s.id) ?? 0,
      color: s.color,
      sortOrder: s.sortOrder,
    }));
  }

  /**
   * One tile per CONFIGURED OrderStatus for the Activity view: how many
   * DISTINCT orders entered that status during the period.
   *
   * The event rows arrive ALREADY normalized: the lifecycle query maps the
   * dispatch/courier literal forms ('PICKED_UP' / 'DELIVERED') onto the
   * canonical names ('Shipping' / 'Delivered') and counts DISTINCT order_id
   * per canonical status, so one delivered order contributes exactly one to
   * Delivered even when it has both a timeline entry and a dispatch row.
   * This method is therefore a straight lookup — it must NOT sum two
   * spellings of one status, and must NOT take a max across sources (both
   * were wrong: the sum double-counted, the max under-counted). `Pending`
   * is an ORDER-CREATION measure, not a transition, so it takes `newOrders`
   * (orders created in the period) — the panel labels it "New Orders".
   */
  private async activityStatusCounts(
    eventRows: Array<{ status: string | null; orders: number }>,
    newOrders: number,
  ): Promise<StatusCount[]> {
    const statuses = await this.prisma.orderStatus.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { name: true, color: true, sortOrder: true },
    });

    const events = new Map<string, number>();
    for (const row of eventRows) {
      if (!row.status) continue;
      events.set(row.status, (events.get(row.status) ?? 0) + row.orders);
    }

    return statuses.map((s) => {
      const count = s.name === 'Pending' ? newOrders : (events.get(s.name) ?? 0);
      return { name: s.name, count, color: s.color, sortOrder: s.sortOrder };
    });
  }

  /** Count for one status out of a distribution (0 when absent). */
  private countOf(statusCounts: StatusCount[], name: string): number {
    return statusCounts.find((s) => s.name === name)?.count ?? 0;
  }

  async getActivityLog() {
    try {
      const activities = await this.prisma.order.findMany({
        where: { trashedAt: null },
        take: 20,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          displayId: true,
          status: { select: { name: true } },
          updatedAt: true,
          customer: { select: { name: true } },
        },
      });
      return activities.map((a) => ({
        id: a.id,
        displayId: a.displayId,
        status: a.status.name,
        customerName: a.customer?.name || 'Unknown',
        updatedAt: a.updatedAt,
      }));
    } catch (error) {
      this.logger.error(
        `getActivityLog failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to fetch activity log');
    }
  }
}
