import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private dateFilter(startDate?: string, endDate?: string): { createdAt?: { gte?: Date; lte?: Date } } {
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

  async getStats(startDate?: string, endDate?: string) {
    const dateFilter = this.dateFilter(startDate, endDate);
    const [
      totalOrders,
      revenueAgg,
      totalCustomers,
      totalProducts,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.count({ where: { ...dateFilter } }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { ...dateFilter },
      }),
      this.prisma.user.count({ where: { role: 'customer' } }),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.order.findMany({
        where: { ...dateFilter },
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
  }

  async getAnalytics(startDate?: string, endDate?: string) {
    const dateFilter = this.dateFilter(startDate, endDate);
    const effectiveDateFilter = Object.keys(dateFilter).length > 0
      ? dateFilter
      : { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } };

    const [ordersLast30Days, revenueLast30Days] = await Promise.all([
      this.prisma.order.count({ where: { ...effectiveDateFilter } }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { ...effectiveDateFilter },
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

  async getPendingOrders(startDate?: string, endDate?: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        ...this.dateFilter(startDate, endDate),
        status: { name: { in: ['Pending', 'Payment Pending'] } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { status: true, customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } }, _count: { select: { items: true } } },
    });
    return orders.map(o => ({
      id: o.id,
      displayId: o.displayId,
      total: Number(o.total),
      status: o.status.name,
      customerName: o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : 'Unknown',
      customerPhone: o.customer?.phoneNumber || '',
      itemCount: o._count.items,
      createdAt: o.createdAt,
    }));
  }

  async getLowStockProducts() {
    const products = await this.prisma.product.findMany({
      where: { manageStock: true },
      select: { id: true, name: true, slug: true, sku: true, stock: true, lowStockQty: true, images: true },
    });
    const lowStock = products.filter(p => p.stock <= (p.lowStockQty || 0));
    return {
      count: lowStock.length,
      products: lowStock.sort((a, b) => a.stock - b.stock).slice(0, 20),
    };
  }

  async getTopProducts(startDate?: string, endDate?: string, limit = 10) {
    const safeLimit = Math.max(1, Math.min(100, limit));
    const dateFilter = this.dateFilter(startDate, endDate);
    const orders = await this.prisma.order.findMany({
      where: { ...dateFilter },
      select: { items: { select: { productId: true, quantity: true, product: { select: { name: true, images: true } } } } },
    });
    const productMap = new Map<string, { name: string; image: string; quantity: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        if (!item.productId) continue;
        const rawImages = item.product?.images as string[] | undefined;
        const image = Array.isArray(rawImages) ? (rawImages[0] || '') : '';
        const entry = productMap.get(item.productId) || { name: item.product?.name || 'Unknown', image, quantity: 0 };
        entry.quantity += item.quantity;
        productMap.set(item.productId, entry);
      }
    }
    return Array.from(productMap.entries())
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, safeLimit)
      .map(([id, data]) => ({ id, ...data }));
  }

  async getOrderStatusDistribution(startDate?: string, endDate?: string) {
    const orders = await this.prisma.order.groupBy({
      by: ['statusId'],
      _count: true,
      _sum: { total: true },
      where: { ...this.dateFilter(startDate, endDate) },
    });
    const statuses = await this.prisma.orderStatus.findMany();
    const statusMap = new Map(statuses.map(s => [s.id, s.name]));
    return orders.map(o => ({
      status: statusMap.get(o.statusId) || 'Unknown',
      count: o._count,
      totalAmount: Number(o._sum.total || 0),
    }));
  }

  async getRevenueByPaymentMethod(startDate?: string, endDate?: string) {
    const dateFilter = this.dateFilter(startDate, endDate);
    const payments = await this.prisma.payment.findMany({
      where: { ...dateFilter, status: 'PAID' },
      select: { gatewayCode: true, amount: true },
    });
    const grouped = new Map<string, number>();
    for (const p of payments) {
      grouped.set(p.gatewayCode || 'unknown', (grouped.get(p.gatewayCode || 'unknown') || 0) + Number(p.amount));
    }
    return Array.from(grouped.entries()).map(([method, revenue]) => ({ method, revenue }));
  }

  async getNewCustomers(startDate?: string, endDate?: string) {
    return this.prisma.user.findMany({
      where: { ...this.dateFilter(startDate, endDate), role: 'customer' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, firstName: true, lastName: true, email: true, createdAt: true },
    });
  }

  async getPendingRefunds() {
    return this.prisma.refund.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { order: { select: { displayId: true } } },
    });
  }

  async getPendingDispatch() {
    return this.prisma.order.findMany({
      where: { status: { name: 'Confirmed' } },
      take: 10,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getPendingPayments() {
    return this.prisma.payment.findMany({
      where: { status: 'PENDING' },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { displayId: true } } },
    });
  }

  async getTodayKpi() {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const dateFilter = { createdAt: { gte: todayStart, lte: todayEnd } };
    const [orders, delivered, pendingPayments, pendingRefunds] = await Promise.all([
      this.prisma.order.count({ where: { ...dateFilter } }),
      this.prisma.order.count({ where: { ...dateFilter, status: { name: 'Delivered' } } }),
      this.prisma.payment.count({ where: { createdAt: { gte: todayStart }, status: 'PENDING' } }),
      this.prisma.refund.count({ where: { createdAt: { gte: todayStart }, status: 'pending' } }),
    ]);
    return { orders, delivered, pendingPayments, pendingRefunds };
  }

  async getActivityLog() {
    const activities = await this.prisma.order.findMany({
      take: 20,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, displayId: true, status: { select: { name: true } }, updatedAt: true, customer: { select: { firstName: true, lastName: true } } },
    });
    return activities.map(a => ({
      id: a.id,
      displayId: a.displayId,
      status: a.status.name,
      customerName: a.customer ? `${a.customer.firstName} ${a.customer.lastName}` : 'Unknown',
      updatedAt: a.updatedAt,
    }));
  }
}
