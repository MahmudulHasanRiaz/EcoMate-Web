import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateCustomer(phone: string, name: string): Promise<{ id: string }> {
    const nameParts = (name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || '';

    const existing = await this.prisma.user.findFirst({
      where: { phoneNumber: phone, role: 'customer' },
    });

    if (existing) {
      if (existing.firstName !== firstName || existing.lastName !== lastName) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { firstName, lastName },
        });
      }
      return { id: existing.id };
    }

    const phoneKey = phone.replace(/[^\d]/g, '');
    const hashedPassword = await bcrypt.hash(randomUUID(), 12);

    const user = await this.prisma.user.create({
      data: {
        firstName,
        lastName,
        username: `cust_${phoneKey}`,
        email: `cust_${phoneKey}@ecomate.local`,
        phoneNumber: phone,
        password: hashedPassword,
        role: 'customer',
      },
    });

    await this.prisma.userSettings.create({
      data: { userId: user.id },
    });

    return { id: user.id };
  }

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
        id: true,
        displayId: true,
        total: true,
        statusId: true,
        createdAt: true,
        status: { select: { name: true, color: true } },
      },
    });

    const totalOrders = orders.length;
    const totalSpent = orders.reduce((s, o) => s + Number(o.total), 0);
    const lastOrder = orders[0] || null;

    return {
      customer: user,
      summary: {
        totalOrders,
        totalSpent,
        lastOrderDate: lastOrder?.createdAt || null,
      },
      recentOrders: orders.slice(0, 5),
    };
  }
}
