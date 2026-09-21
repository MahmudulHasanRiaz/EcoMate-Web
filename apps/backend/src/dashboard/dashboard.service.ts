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
           AND ($1::timestamptz IS NULL OR o."createdAt" >= $1)
           AND ($2::timestamptz IS NULL OR o."createdAt" <= $2)
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
           AND ($1::timestamptz IS NULL OR "createdAt" >= $1)
           AND ($2::timestamptz IS NULL OR "createdAt" <= $2)
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

      // Resolve status IDs once (avoid N+1 per query).
      const [confirmedStatus, packedStatus, deliveredStatus] =
        await Promise.all([
          this.prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } }),
          this.prisma.orderStatus.findUnique({ where: { name: 'Packed' } }),
          this.prisma.orderStatus.findUnique({ where: { name: 'Delivered' } }),
        ]);

      const confirmedId = confirmedStatus?.id;
      const packedId = packedStatus?.id;

      // New Orders: orders created in the selected period (not trashed).
      const newOrders = await this.prisma.order.count({
        where: { createdAt: dateFilter, trashedAt: null },
      });

      // Confirmed: orders currently in Confirmed status whose createdAt
      // falls in the selected period.
      let confirmedCount = 0;
      if (confirmedId) {
        confirmedCount = await this.prisma.order.count({
          where: {
            statusId: confirmedId,
            createdAt: dateFilter,
            trashedAt: null,
          },
        });
      }

      // Packed: orders currently in Packed status within selected period.
      let packedCount = 0;
      if (packedId) {
        packedCount = await this.prisma.order.count({
          where: {
            statusId: packedId,
            createdAt: dateFilter,
            trashedAt: null,
          },
        });
      }

      // Picked Up: distinct orders with a dispatch in PICKED_UP state,
      // measured by pickedUpAt timestamp (not order createdAt).
      // distinct: ['orderId'] prevents double-counting.
      const pickedUpDispatches = await this.prisma.dispatch.findMany({
        where: {
          status: 'PICKED_UP',
          pickedUpAt: dateFilter,
        },
        select: { orderId: true },
        distinct: ['orderId'],
      });
      const pickedUpCount = pickedUpDispatches.length;

      // Delivered: distinct orders with a dispatch in DELIVERED state,
      // measured by deliveredAt timestamp.
      const deliveredDispatches = await this.prisma.dispatch.findMany({
        where: {
          status: 'DELIVERED',
          deliveredAt: dateFilter,
        },
        select: { orderId: true },
        distinct: ['orderId'],
      });
      const deliveredCount = deliveredDispatches.length;

      // Pending Payments: current outstanding PENDING payments (snapshot,
      // NOT period-filtered — this is an actionable backlog metric).
      const pendingPayments = await this.prisma.payment.count({
        where: { status: 'PENDING' },
      });

      // Pending Refunds: current pending refund backlog (snapshot).
      const pendingRefunds = await this.prisma.refund.count({
        where: { status: 'pending' },
      });

      // Revenue: sum of PAID payment amounts within selected period.
      // Payment date (not order date) is the authoritative business date
      // for revenue recognition. Cancelled/refunded payments excluded
      // by the PAID status gate.
      const revenueAgg = await this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: 'PAID',
          createdAt: dateFilter,
        },
      });

      return {
        newOrders,
        confirmed: confirmedCount,
        packed: packedCount,
        pickedUp: pickedUpCount,
        delivered: deliveredCount,
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
