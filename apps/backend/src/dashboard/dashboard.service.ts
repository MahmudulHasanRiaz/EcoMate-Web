import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dhakaDayRange, endOfDhakaDay, startOfDhakaDay } from '../common/utils/dhaka-time';

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
        this.prisma.order.count({ where: { ...dateFilter, trashedAt: null } }),
        this.prisma.payment.aggregate({
          _sum: { amount: true },
          where: { ...dateFilter },
        }),
        this.prisma.userProfile.count({ where: { role: 'customer' } }),
        this.prisma.product.count({ where: { isActive: true } }),
        this.prisma.order.findMany({
          where: { ...dateFilter, trashedAt: null },
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
          this.prisma.order.count({ where: { ...effectiveDateFilter, trashedAt: null } }),
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
          status: { name: { in: ['Pending', 'Payment Pending'] } },
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
        where: { ...this.dateFilter(startDate, endDate), trashedAt: null },
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
        `SELECT COALESCE("gatewayCode", 'unknown') AS method,
                SUM(amount)::text AS revenue
         FROM "Payment"
         WHERE status = 'PAID'
           AND ($1::timestamp IS NULL OR ("createdAt" AT TIME ZONE 'UTC') >= ($1::timestamp AT TIME ZONE 'UTC'))
           AND ($2::timestamp IS NULL OR ("createdAt" AT TIME ZONE 'UTC') <= ($2::timestamp AT TIME ZONE 'UTC'))
         GROUP BY "gatewayCode"`,
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
        where: { createdAt: dateFilter, trashedAt: null },
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
      type LifecycleRow = {
        confirmed: number;
        packed: number;
        picked_up: number;
        delivered: number;
      };
      const [lifecycle] = await this.prisma.$queryRawUnsafe<LifecycleRow[]>(
        `WITH period AS (
           -- Params arrive as timezone-less UTC wall clock (Prisma sends
           -- DateTime params that way). Casting them straight to timestamptz
           -- would make Postgres read them in the session timezone, shifting
           -- every boundary by the session offset. Pin them to UTC first.
           SELECT ($1::timestamp AT TIME ZONE 'UTC') AS range_start,
                  ($2::timestamp AT TIME ZONE 'UTC') AS range_end
         ),
         events AS (
           -- 1. Order lifecycle transitions recorded in the order timeline
           SELECT o.id AS order_id, e->>'status' AS status
           FROM "Order" o
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.timeline::jsonb, '[]'::jsonb)) e
           CROSS JOIN period p
           WHERE o."trashedAt" IS NULL
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
           SELECT d."orderId", 'PICKED_UP'
           FROM "Dispatch" d
           JOIN "Order" o ON o.id = d."orderId" AND o."trashedAt" IS NULL
           CROSS JOIN period p
           WHERE (d."pickedUpAt" AT TIME ZONE 'UTC') BETWEEN p.range_start AND p.range_end
           UNION ALL
           -- 2b. Delivery event (manual dispatch board)
           SELECT d."orderId", 'DELIVERED'
           FROM "Dispatch" d
           JOIN "Order" o ON o.id = d."orderId" AND o."trashedAt" IS NULL
           CROSS JOIN period p
           WHERE (d."deliveredAt" AT TIME ZONE 'UTC') BETWEEN p.range_start AND p.range_end
         )
         SELECT
           COUNT(DISTINCT order_id) FILTER (WHERE status = 'Confirmed')::int AS confirmed,
           COUNT(DISTINCT order_id) FILTER (WHERE status = 'Packed')::int AS packed,
           COUNT(DISTINCT order_id) FILTER (WHERE status = 'PICKED_UP')::int AS picked_up,
           COUNT(DISTINCT order_id) FILTER (WHERE status IN ('Delivered', 'DELIVERED'))::int AS delivered
         FROM events`,
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

      return {
        newOrders,
        confirmed: lifecycle?.confirmed ?? 0,
        packed: lifecycle?.packed ?? 0,
        pickedUp: lifecycle?.picked_up ?? 0,
        delivered: lifecycle?.delivered ?? 0,
        pendingPayments,
        pendingRefunds,
        revenue: Number(revenueAgg?._sum?.amount || 0),
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
        where: { createdAt: dateFilter, trashedAt: null },
      });

      // ── Current-status distribution of the cohort ──────────────────────
      // Where the period-created orders stand NOW (single current status per
      // order). Exact status-name match only: 'Shipping' feeds the `pickedUp`
      // field (frontend labels it "Shipping" in Pipeline view — distinct from
      // Activity's pickup EVENT). Non-lifecycle statuses (Pending, Hold,
      // Packing Hold, Cancelled, Returned, …) stay in `newOrders` only, so the
      // tile sum is deliberately allowed to be smaller than the cohort total.
      const groups = await this.prisma.order.groupBy({
        by: ['statusId'],
        _count: true,
        where: { createdAt: dateFilter, trashedAt: null },
      });
      const statuses = await this.prisma.orderStatus.findMany();
      const statusMap = new Map(statuses.map((s) => [s.id, s.name]));
      let confirmed = 0;
      let packed = 0;
      let pickedUp = 0;
      let delivered = 0;
      for (const g of groups) {
        const name = statusMap.get(g.statusId);
        if (name === 'Confirmed') confirmed += g._count;
        else if (name === 'Packed') packed += g._count;
        else if (name === 'Shipping') pickedUp += g._count;
        else if (name === 'Delivered') delivered += g._count;
      }

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
        confirmed,
        packed,
        pickedUp,
        delivered,
        pendingPayments,
        pendingRefunds,
        revenue: Number(revenueAgg?._sum?.amount || 0),
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
