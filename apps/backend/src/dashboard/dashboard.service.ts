import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    if (startDate) filter.gte = new Date(startDate);
    if (endDate) {
      filter.lte = endDate.includes('T')
        ? new Date(endDate)
        : new Date(endDate + 'T23:59:59.999Z');
    }
    return { createdAt: filter };
  }

  private getDateRange(startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : null;
    const end = endDate
      ? endDate.includes('T')
        ? new Date(endDate)
        : new Date(endDate + 'T23:59:59.999Z')
      : null;
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
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          _count: { select: { items: true } },
        },
      });
      return orders.map((o) => ({
        id: o.id,
        displayId: o.displayId,
        total: Number(o.total),
        status: o.status.name,
        customerName: o.customer?.name || 'Unknown',
        customerPhone: o.customer?.phone || '',
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

      const [countResult, rows] = await Promise.all([
        this.prisma.$queryRawUnsafe<{ count: number }[]>(
          `SELECT COUNT(*)::int AS count FROM "Product" WHERE "manageStock" = true AND "stock" <= COALESCE("lowStockQty", 0)`,
        ),
        this.prisma.$queryRawUnsafe<LowStockRow[]>(
          `SELECT id, name, slug, sku, stock, "lowStockQty", images::text AS images
           FROM "Product"
           WHERE "manageStock" = true AND "stock" <= COALESCE("lowStockQty", 0)
           ORDER BY "stock" ASC
           LIMIT 20`,
        ),
      ]);

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
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      const dateFilter = { createdAt: { gte: todayStart, lte: todayEnd } };
      const [orders, delivered, pendingPayments, pendingRefunds] =
        await Promise.all([
          this.prisma.order.count({ where: { ...dateFilter, trashedAt: null } }),
          this.prisma.order.count({
            where: { ...dateFilter, status: { name: 'Delivered' }, trashedAt: null },
          }),
          this.prisma.payment.count({
            where: { createdAt: { gte: todayStart }, status: 'PENDING' },
          }),
          this.prisma.refund.count({
            where: { createdAt: { gte: todayStart }, status: 'pending' },
          }),
        ]);
      return { orders, delivered, pendingPayments, pendingRefunds };
    } catch (error) {
      this.logger.error(
        `getTodayKpi failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to fetch today KPI');
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
