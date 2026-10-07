import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
        // Typing ANY linked number (primary or secondary) must surface the
        // same customer: link-table ids join the OR. userProfile.id and
        // customerProfile.id share the same value by construction.
        const linked = await this.prisma.customerPhone.findMany({
          where: { phone: normalizedPhone },
          select: { customerProfileId: true },
        });
        if (linked.length > 0) {
          where.OR.push({ id: { in: linked.map((l) => l.customerProfileId) } });
        }
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

    // Attach linked numbers so admin search can match a typed secondary
    // against the customer it belongs to (the client filters exact matches).
    const rowIds = rows.map((r) => r.id);
    const linkRows = rowIds.length
      ? await this.prisma.customerPhone.findMany({
          where: { customerProfileId: { in: rowIds } },
          select: { customerProfileId: true, phone: true },
        })
      : [];
    const linksById = new Map<string, string[]>();
    for (const l of linkRows) {
      const list = linksById.get(l.customerProfileId) || [];
      list.push(l.phone);
      linksById.set(l.customerProfileId, list);
    }

    return {
      data: rows.map((r) => ({ ...r, linkedPhones: linksById.get(r.id) || [] })),
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
        take: 15,
        select: {
          id: true,
          displayId: true,
          total: true,
          statusId: true,
          createdAt: true,
          secondaryPhone: true,
          status: { select: { name: true, color: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

    const lastOrder = recentOrders[0] || null;

    // ---- Linked phones (primary + secondaries), each with block state ----
    const linkedPhones = await this.getLinkedPhones(user.id);
    const phoneBlockRows = linkedPhones.length
      ? await this.prisma.blockedPhone.findMany({
          where: { phone: { in: linkedPhones.map((p) => p.phone) } },
          select: { id: true, phone: true },
        })
      : [];
    const blockedPhoneIds = new Set(phoneBlockRows.map((b) => b.phone));
    const phones = linkedPhones.map((p) => ({
      ...p,
      blocked: blockedPhoneIds.has(p.phone),
      blockId: phoneBlockRows.find((b) => b.phone === p.phone)?.id ?? null,
    }));

    // ---- IPs actually used by THIS customer (orders + telemetry) ----
    // Never the global block list: only addresses this customer's own orders
    // carried, plus profile telemetry. Each carries its live block state so
    // the UI can block/unblock inline.
    const ipRows = await this.prisma.order.findMany({
      where: { customerId: user.id, trashedAt: null, ipAddress: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { ipAddress: true, createdAt: true, displayId: true },
    });
    const ipMap = new Map<string, { lastSeen: Date; orderCount: number; lastOrder: string | null }>();
    const touchIp = (ip: string | null, at: Date, order: string | null) => {
      if (!ip) return;
      const prev = ipMap.get(ip);
      if (prev) {
        prev.orderCount += 1;
        if (at > prev.lastSeen) {
          prev.lastSeen = at;
          prev.lastOrder = order;
        }
      } else {
        ipMap.set(ip, { lastSeen: at, orderCount: 1, lastOrder: order });
      }
    };
    for (const r of ipRows) touchIp(r.ipAddress, r.createdAt, r.displayId);
    const profileIps = await this.prisma.customerProfile.findUnique({
      where: { id: user.id },
      select: { lastOrderIp: true },
    }).catch(() => null);
    touchIp(user.lastIp, user.updatedAt, null);
    if (profileIps?.lastOrderIp) touchIp(profileIps.lastOrderIp, user.updatedAt, null);
    const ipList = [...ipMap.keys()];
    const ipBlockRows = ipList.length
      ? await this.prisma.blockedIp.findMany({
          where: { ip: { in: ipList }, isActive: true },
          select: { id: true, ip: true, reason: true },
        })
      : [];
    const ips = [...ipMap.entries()].map(([ip, info]) => {
      const block = ipBlockRows.find((b) => b.ip === ip);
      return {
        ip,
        ...info,
        lastSeen: info.lastSeen.toISOString(),
        blocked: !!block,
        blockId: block?.id ?? null,
        blockReason: block?.reason ?? null,
      };
    }).sort((a, b) => b.orderCount - a.orderCount);

    // ---- Address book: shipping in serial, billing separate ----
    const addresses = await this.prisma.customerAddress.findMany({
      where: { customerProfileId: user.id },
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    // ---- Performance: delivered / cancelled / success rate ----
    const statuses = await this.prisma.orderStatus.findMany({
      select: { id: true, name: true },
    });
    const deliveredIds = statuses.filter((s) => s.name === 'Delivered').map((s) => s.id);
    const cancelledIds = statuses
      .filter((s) => ['Cancelled', 'Returned', 'Return Pending', 'Damaged', 'Partial'].includes(s.name))
      .map((s) => s.id);
    const baseWhere = { customerId: user.id, trashedAt: null, kind: 'SALE' as const };
    const [deliveredCount, cancelledCount] = await Promise.all([
      deliveredIds.length
        ? this.prisma.order.count({ where: { ...baseWhere, statusId: { in: deliveredIds } } })
        : Promise.resolve(0),
      cancelledIds.length
        ? this.prisma.order.count({ where: { ...baseWhere, statusId: { in: cancelledIds } } })
        : Promise.resolve(0),
    ]);
    const totalOrders = aggregation._count;
    const totalSpent = Number(aggregation._sum.total || 0);

    return {
      customer: user,
      summary: {
        totalOrders,
        totalSpent,
        lastOrderDate: lastOrder?.createdAt || null,
      },
      stats: {
        delivered: deliveredCount,
        cancelled: cancelledCount,
        successRate: totalOrders > 0 ? Math.round((deliveredCount / totalOrders) * 100) : 0,
        avgOrderValue: totalOrders > 0 ? Math.round((totalSpent / totalOrders) * 100) / 100 : 0,
      },
      phones,
      ips,
      addresses: {
        shipping: addresses.filter((a) => a.type === 'SHIPPING'),
        billing: addresses.filter((a) => a.type === 'BILLING'),
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

  /**
   * Resolve a customer id from ANY linked number (primary or secondary).
   * Returns the matched customer, or null when none of the numbers is known.
   * When numbers point at DIFFERENT customers the primary-phone match wins;
   * callers that must refuse ambiguity get `conflicted: true` instead of a
   * silent pick (staff flows throw; guest flows keep the primary's owner).
   */
  async resolveCustomerIdByPhones(
    phones: (string | null | undefined)[],
  ): Promise<{ customerId: string | null; conflicted: boolean }> {
    const normalized = [...new Set(phones.map((p) => (p ? normalizePhone(p) : null)).filter(Boolean))] as string[];
    if (normalized.length === 0) return { customerId: null, conflicted: false };

    const rows = await this.prisma.customerPhone.findMany({
      where: { phone: { in: normalized } },
      select: { phone: true, customerProfileId: true },
    });
    if (rows.length === 0) return { customerId: null, conflicted: false };

    const byPhone = new Map(rows.map((r) => [r.phone, r.customerProfileId]));
    const firstHit = byPhone.get(normalized[0]);
    if (firstHit) {
      const conflicted = rows.some((r) => r.customerProfileId !== firstHit);
      return { customerId: firstHit, conflicted };
    }
    const distinct = [...new Set(rows.map((r) => r.customerProfileId))];
    return { customerId: distinct[0] ?? null, conflicted: distinct.length > 1 };
  }

  /**
   * Link normalized numbers to a customer. The UNIQUE constraint on
   * CustomerPhone.phone is the safety net: a number owned by ANOTHER customer
   * throws ConflictException (refuse + warn) — two identities are never
   * merged through this path. Idempotent for already-linked numbers.
   */
  async linkPhones(
    customerProfileId: string,
    phones: (string | null | undefined)[],
    source: 'primary' | 'secondary' = 'secondary',
    tx?: any,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const normalized = [...new Set(phones.map((p) => (p ? normalizePhone(p) : null)).filter(Boolean))] as string[];
    const linked: string[] = [];
    for (const phone of normalized) {
      const existing = await client.customerPhone.findUnique({
        where: { phone },
        select: { customerProfileId: true },
      });
      if (existing) {
        if (existing.customerProfileId !== customerProfileId) {
          throw new ConflictException(
            'This phone number is already linked to another customer.',
          );
        }
        linked.push(phone);
        continue;
      }
      await client.customerPhone.create({
        data: { customerProfileId, phone, source },
      });
      linked.push(phone);
    }
    return linked;
  }

  /** Every number linked to a customer, primary first. */
  async getLinkedPhones(customerProfileId: string): Promise<
    Array<{ phone: string; source: string; isPrimary: boolean }>
  > {
    const [profile, rows] = await Promise.all([
      this.prisma.customerProfile.findUnique({
        where: { id: customerProfileId },
        select: { phone: true },
      }),
      this.prisma.customerPhone.findMany({
        where: { customerProfileId },
        orderBy: [{ source: 'asc' }, { createdAt: 'asc' }],
        select: { phone: true, source: true },
      }),
    ]);
    const seen = new Set<string>();
    const out: Array<{ phone: string; source: string; isPrimary: boolean }> = [];
    if (profile?.phone && normalizePhone(profile.phone)) {
      const primary = normalizePhone(profile.phone)!;
      seen.add(primary);
      out.push({ phone: primary, source: 'primary', isPrimary: true });
    }
    for (const r of rows) {
      if (seen.has(r.phone)) continue;
      seen.add(r.phone);
      out.push({
        phone: r.phone,
        source: r.source,
        isPrimary: !!profile?.phone && r.phone === normalizePhone(profile.phone),
      });
    }
    return out;
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

    // Typing ANY linked number (primary or secondary) resolves the same
    // customer: the link table is checked before the primary column.
    const linked = await this.resolveCustomerIdByPhones([normalized]);
    if (linked.customerId && !linked.conflicted) {
      const owner = await this.prisma.customerProfile.findUnique({
        where: { id: linked.customerId },
        select: { id: true, email: true, phone: true },
      });
      if (owner) {
        if (email && this.isSyntheticEmail(owner.email, owner.phone)) {
          await this.prisma.customerProfile.update({
            where: { id: owner.id },
            data: { email },
          });
        }
        // Backfill the primary link row for profiles predating CustomerPhone.
        await this.linkPhones(owner.id, [owner.phone], 'primary').catch(() => undefined);
        return { id: owner.id };
      }
    }

    // First, check if a CustomerProfile exists for this phone
    const existingProfile = await this.prisma.customerProfile.findUnique({
      where: { phone: normalized },
    });

    if (existingProfile) {      // OWNERSHIP: an existing customer's canonical identity is NEVER rewritten
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
      await this.linkPhones(existingProfile.id, [existingProfile.phone], 'primary').catch(() => undefined);
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
      await this.linkPhones(existingUser.id, [normalized], 'primary').catch(() => undefined);
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
    await this.linkPhones(user.id, [normalized], 'primary').catch(() => undefined);

    return { id: user.id };
  }

  /**
   * Address book for the detail page (shipping serial + billing separate).
   * Legacy customers may have no CustomerProfile row — then there is simply
   * no book, never an error.
   */
  async getAddresses(customerProfileId: string) {
    const addresses = await this.prisma.customerAddress.findMany({
      where: { customerProfileId },
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return {
      shipping: addresses.filter((a) => a.type === 'SHIPPING'),
      billing: addresses.filter((a) => a.type === 'BILLING'),
    };
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
