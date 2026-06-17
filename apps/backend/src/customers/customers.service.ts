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

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        phoneNumber: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user || user.role !== 'customer') return null;

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
      recentOrders: orders.slice(0, 10),
    };
  }

  async isPhoneBlocked(phone: string): Promise<boolean> {
    const normalized = normalizePhone(phone);
    if (!normalized) return false;
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber: normalized, role: 'customer', status: 'suspended' },
      select: { id: true },
    });
    return !!user;
  }

  async blockPhone(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'suspended' },
    });
  }

  async unblockPhone(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'active' },
    });
  }

  async findOrCreateCustomer(
    phone: string,
    name: string,
  ): Promise<{ id: string }> {
    let normalized = normalizePhone(phone);
    if (!normalized) {
      const cleaned = phone.replace(/[^\d+]/g, '');
      if (cleaned.length >= 7 && cleaned.length <= 15) {
        normalized = cleaned.startsWith('+') ? cleaned : '+' + cleaned;
      } else {
        throw new BadRequestException('Invalid phone number format');
      }
    }

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
    // Use a pre-calculated dummy hash to avoid extremely slow CPU-blocking bcrypt hashing during checkout/import.
    // Since this is a guest account with a random UUID password, it cannot be logged into anyway until a password reset.
    const hashedPassword = '$2a$12$5K1R68iJb0Z2kYf.p0jOeuZ/XmS9M0d.6oZc1p9e6p9z1a2b3c4d5';

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
