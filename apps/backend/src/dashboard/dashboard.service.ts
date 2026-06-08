import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [
      totalOrders,
      revenueAgg,
      totalCustomers,
      totalProducts,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.payment.aggregate({ _sum: { amount: true } }),
      this.prisma.user.count({ where: { role: 'customer' } }),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.order.findMany({
        take: 5,
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
  }

  async getAnalytics() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [ordersLast30Days, revenueLast30Days] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    return {
      ordersLast30Days,
      revenueLast30Days: Number(revenueLast30Days._sum.amount || 0),
      totalClicks: 0,
      uniqueVisitors: 0,
      bounceRate: '0%',
    };
  }
}
