import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/utils/phone-utils';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private config: ConfigService,
  ) {}

  private getEmailDomain(): string {
    const appUrl = this.config.get<string>('APP_URL') || '';
    try {
      const host = new URL(appUrl).hostname;
      return host || 'localhost';
    } catch {
      return appUrl.replace(/^https?:\/\//, '').split(':')[0] || 'localhost';
    }
  }

  /**
   * True when an address is the synthetic placeholder WE generated
   * (`cust_<phoneDigits>@<app domain>`) rather than something the customer
   * supplied. Only a synthetic address may be replaced by an incoming order;
   * a real address is customer-owned and stays put.
   *
   * The phone must match too, so a synthetic-looking address belonging to a
   * different customer is never rewritten.
   */
  private isSyntheticEmail(storedEmail: string | null, phone: string): boolean {
    if (!storedEmail) return true; // nothing real stored yet
    const phoneDigits = (phone || '').replace(/[^\d]/g, '');
    if (!phoneDigits) return false;
    const domain = this.getEmailDomain();
    return (
      storedEmail.toLowerCase() === `cust_${phoneDigits}@${domain}`.toLowerCase()
    );
  }

  async findAll(query: { search?: string; page?: number; perPage?: number }) {
    const page =
      Number.isFinite(query.page) && query.page! > 0 ? query.page! : 1;
    const perPage =
      Number.isFinite(query.perPage) && query.perPage! > 0
        ? Math.min(query.perPage!, 100)
        : 20;
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
      this.prisma.userProfile.findMany({
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
          addresses: {
            where: { isDefault: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { street: true, city: true, state: true, zipCode: true },
          },
        },
      }),
      this.prisma.userProfile.count({ where }),
    ]);

    const rows = data.map((u: any) => {
      const a = u.addresses?.[0];
      return {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phoneNumber: u.phoneNumber,
        createdAt: u.createdAt,
        address: a
          ? [a.street, a.city, a.state, a.zipCode].filter(Boolean).join(', ')
          : '',
      };
    });

    return {
      data: rows,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.userProfile.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        phoneNumber: true,
        lastIp: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user || user.role !== 'customer') return null;

    const [aggregation, recentOrders] = await Promise.all([
      this.prisma.order.aggregate({
        where: { customerId: user.id, trashedAt: null, kind: 'SALE' },
        _count: true,
        _sum: { total: true },
      }),
      this.prisma.order.findMany({
        where: { customerId: user.id, trashedAt: null, kind: 'SALE' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          displayId: true,
          total: true,
          statusId: true,
          createdAt: true,
          status: { select: { name: true, color: true } },
        },
      }),
    ]);

    const lastOrder = recentOrders[0] || null;

    return {
      customer: user,
      summary: {
        totalOrders: aggregation._count,
        totalSpent: Number(aggregation._sum.total || 0),
        lastOrderDate: lastOrder?.createdAt || null,
      },
      recentOrders,
    };
  }

  async isPhoneBlocked(phone: string): Promise<boolean> {
    const normalized = normalizePhone(phone);
    if (!normalized) return false;
    const user = await this.prisma.userProfile.findFirst({
      where: { phoneNumber: normalized, role: 'customer', status: 'suspended' },
      select: { id: true },
    });
    return !!user;
  }

  async blockPhone(id: string): Promise<void> {
    const user = await this.prisma.userProfile.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!user || user.role !== 'customer')
      throw new NotFoundException('Customer not found');

    await this.prisma.userProfile.update({
      where: { id },
      data: { status: 'suspended' },
    });
  }

  async unblockPhone(id: string): Promise<void> {
    const user = await this.prisma.userProfile.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!user || user.role !== 'customer')
      throw new NotFoundException('Customer not found');

    await this.prisma.userProfile.update({
      where: { id },
      data: { status: 'active' },
    });
  }

  async findOrCreateCustomer(
    phone: string,
    name: string,
    clientIp?: string,
    email?: string,
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

    // First, check if a CustomerProfile exists for this phone
    const existingProfile = await this.prisma.customerProfile.findUnique({
      where: { phone: normalized },
    });

    if (existingProfile) {
      // OWNERSHIP: an existing customer's canonical identity is NEVER rewritten
      // by a repeat checkout. This function's job is find-or-create, nothing
      // more. It previously overwrote UserProfile.firstName/lastName and
      // lastIp on EVERY guest checkout keyed only on phone, so a customer who
      // ordered once as "Rahim Uddin" and again as "Md Rahim" was silently
      // renamed. The order-time values belong on the order snapshot, and
      // lastOrderIp is maintained by the order path, not here.
      //
      // ONE NARROW EXCEPTION — synthetic placeholder → real email. We generate
      // `cust_<digits>@<domain>` addresses for customers who order without
      // giving one. That value was never the customer's own data, so replacing
      // it when they later supply a real address is enrichment, not a
      // destructive overwrite. A REAL existing email is never replaced by an
      // order — that stays an explicit profile-edit decision.
      if (email && this.isSyntheticEmail(existingProfile.email, existingProfile.phone)) {
        await this.prisma.customerProfile.update({
          where: { id: existingProfile.id },
          data: { email },
        });
      }
      return { id: existingProfile.id };
    }

    // Check UserProfile by phone (legacy)
    const existingUser = await this.prisma.userProfile.findFirst({
      where: { phoneNumber: normalized, role: 'customer' },
    });

    if (existingUser) {
      // Same rule as above: a legacy UserProfile keeps its own name/email.
      // Only the missing CustomerProfile is created.
      await this.prisma.customerProfile.upsert({
        where: { id: existingUser.id },
        create: { id: existingUser.id, phone: normalized, name, ...(email ? { email } : {}) },
        update: { phone: normalized },
      });
      return { id: existingUser.id };
    }

    const phoneKey = normalized.replace(/[^\d]/g, '');
    const domain = this.getEmailDomain();
    const hashedPassword =
      '$2a$12$5K1R68iJb0Z2kYf.p0jOeuZ/XmS9M0d.6oZc1p9e6p9z1a2b3c4d5';

    const user = await this.prisma.userProfile.create({
      data: {
        firstName,
        lastName,
        username: `cust_${phoneKey}`,
        email: email || `cust_${phoneKey}@${domain}`,
        phoneNumber: normalized,
        password: hashedPassword,
        role: 'customer',
        lastIp: clientIp || null,
      },
    });

    await this.prisma.userSettings.create({
      data: { userId: user.id },
    });

    // Create CustomerProfile with same id
    await this.prisma.customerProfile.create({
      data: {
        id: user.id,
        phone: normalized,
        name,
        ...(email ? { email } : {}),
      },
    });

    return { id: user.id };
  }

  async getOrderSummary(phoneNumber: string) {
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) return null;

    const user = await this.prisma.userProfile.findFirst({
      where: { phoneNumber: normalized, role: 'customer' },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    });

    if (!user) return null;

    const statuses = await this.prisma.orderStatus.findMany({
      select: { id: true, name: true },
    });
    const deliveredIds = statuses.filter(s => s.name === 'Delivered').map(s => s.id);
    const cancelledIds = statuses.filter(s =>
      ['Cancelled', 'Returned', 'Return Pending', 'Damaged', 'Partial'].includes(s.name),
    ).map(s => s.id);

    const [aggregation, recentOrders, deliveredCount, cancelledCount] = await Promise.all([
      this.prisma.order.aggregate({
        where: { customerId: user.id, trashedAt: null, kind: 'SALE' },
        _count: true,
        _sum: { total: true },
      }),
      this.prisma.order.findMany({
        where: { customerId: user.id, trashedAt: null, kind: 'SALE' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          displayId: true,
          total: true,
          statusId: true,
          createdAt: true,
          status: { select: { name: true, color: true } },
        },
      }),
      deliveredIds.length > 0
        ? this.prisma.order.count({ where: { customerId: user.id, trashedAt: null, kind: 'SALE', statusId: { in: deliveredIds } } })
        : Promise.resolve(0),
      cancelledIds.length > 0
        ? this.prisma.order.count({ where: { customerId: user.id, trashedAt: null, kind: 'SALE', statusId: { in: cancelledIds } } })
        : Promise.resolve(0),
    ]);

    const totalSales = aggregation._count;
    const successRate = totalSales > 0 ? Math.round((deliveredCount / totalSales) * 100) : 0;
    const failRate = totalSales > 0 ? Math.round((cancelledCount / totalSales) * 100) : 0;

    return {
      customer: user,
      summary: {
        totalOrders: totalSales,
        totalSpent: Number(aggregation._sum.total || 0),
        lastOrderDate: recentOrders[0]?.createdAt || null,
        delivered: deliveredCount,
        cancelled: cancelledCount,
        successRate,
        failRate,
      },
      recentOrders,
    };
  }
}
