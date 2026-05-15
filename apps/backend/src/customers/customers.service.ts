import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrderSummary(phoneNumber: string) {
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber, role: 'customer' },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    });

    if (!user) return null;

    const orders = await this.prisma.order.findMany({
      where: { customerId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, displayId: true, total: true, statusId: true,
        createdAt: true,
        status: { select: { name: true, color: true } },
      },
    });

    const totalOrders = orders.length;
    const totalSpent = orders.reduce((s, o) => s + Number(o.total), 0);
    const lastOrder = orders[0] || null;

    return {
      customer: user,
      summary: { totalOrders, totalSpent, lastOrderDate: lastOrder?.createdAt || null },
      recentOrders: orders.slice(0, 5),
    };
  }
}
