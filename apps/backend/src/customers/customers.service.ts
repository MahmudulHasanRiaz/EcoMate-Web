import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/utils/phone-utils';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: { search?: string; page?: number; perPage?: number }) {
    const page = query.page || 1;
    const perPage = query.perPage || 20;
    const where: any = { role: 'customer' };

    if (query.search) {
      const normalizedPhone = normalizePhone(query.search);
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
      if (normalizedPhone) {
        where.OR.push({ phoneNumber: normalizedPhone });
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneNumber: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOrCreateCustomer(
    phone: string,
    name: string,
  ): Promise<{ id: string }> {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new BadRequestException('Invalid phone number');

    const nameParts = (name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || '';

    const existing = await this.prisma.user.findFirst({
      where: { phoneNumber: normalized, role: 'customer' },
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

    const phoneKey = normalized.replace(/[^\d]/g, '');
    const hashedPassword = await bcrypt.hash(randomUUID(), 12);

    const user = await this.prisma.user.create({
      data: {
        firstName,
        lastName,
        username: `cust_${phoneKey}`,
        email: `cust_${phoneKey}@ecomate.local`,
        phoneNumber: normalized,
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
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) return null;

    const user = await this.prisma.user.findFirst({
      where: { phoneNumber: normalized, role: 'customer' },
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
