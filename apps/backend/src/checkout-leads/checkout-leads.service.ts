import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { normalizePhone } from '../common/utils/phone-utils';
import { ConvertOrderDto } from './dto/convert-order.dto';

@Injectable()
export class CheckoutLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
  ) {}

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    status?: string;
    assignedToId?: string;
    sort?: string;
    order?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 20;
    const where: any = {};

    if (query.search) {
      const normalizedSearch = normalizePhone(query.search) || query.search;
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: normalizedSearch } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status && query.status !== 'all') where.status = query.status;
    if (query.assignedToId === 'unassigned') where.assignedToId = null;
    else if (query.assignedToId) where.assignedToId = query.assignedToId;

    const [data, total] = await Promise.all([
      this.prisma.checkoutLead.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: {
          [query.sort || 'lastSeenAt']: (query.order || 'desc') as
            | 'asc'
            | 'desc',
        },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          convertedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.checkoutLead.count({ where }),
    ]);

    const orderIds = data
      .map((l) => l.convertedOrderId)
      .filter(Boolean) as string[];
    const orders =
      orderIds.length > 0
        ? await this.prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, displayId: true },
          })
        : [];
    const orderMap = new Map(
      orders.map((o) => [o.id, { id: o.id, displayId: o.displayId }]),
    );

    return {
      data: data.map((l) => ({
        ...l,
        convertedOrder: l.convertedOrderId
          ? orderMap.get(l.convertedOrderId) || null
          : null,
      })),
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const lead = await this.prisma.checkoutLead.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        convertedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!lead) throw new NotFoundException('Checkout lead not found');
    let convertedOrder: { id: string; displayId: string } | null = null;
    if (lead.convertedOrderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: lead.convertedOrderId },
        select: { id: true, displayId: true },
      });
      if (order) convertedOrder = order;
    }
    return { ...lead, convertedOrder };
  }

  async upsert(dto: {
    phone?: string;
    name?: string;
    email?: string;
    address?: any;
    items?: any;
    payload?: any;
    paymentMethod?: string;
    fingerprint?: string;
  }) {
    if (dto.phone) {
      const normalized = normalizePhone(dto.phone);
      if (!normalized) {
        throw new BadRequestException(
          'Invalid Bangladeshi phone number format. Use 01XXXXXXXXX or +8801XXXXXXXXX.',
        );
      }
      dto.phone = normalized;
    }

    if (dto.fingerprint) {
      const existing = await this.prisma.checkoutLead.findFirst({
        where: { fingerprint: dto.fingerprint, status: 'PENDING' },
      });
      if (existing) {
        return this.prisma.checkoutLead.update({
          where: { id: existing.id },
          data: {
            name: dto.name,
            email: dto.email,
            address: dto.address,
            items: dto.items,
            payload: dto.payload,
            paymentMethod: dto.paymentMethod,
            lastSeenAt: new Date(),
            occurrences: { increment: 1 },
          },
        });
      }
    }

    return this.prisma.checkoutLead.create({
      data: {
        displayId: await this.leadDisplayId(),
        phone: dto.phone,
        name: dto.name,
        email: dto.email,
        address: dto.address,
        items: dto.items,
        payload: dto.payload,
        paymentMethod: dto.paymentMethod,
        fingerprint: dto.fingerprint,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  }

  async updateStatus(id: string, status: string, userId?: string) {
    const lead = await this.findOne(id);
    if (lead.status === 'CONVERTED') {
      throw new BadRequestException('Cannot change status of a converted lead');
    }

    const data: any = { status };
    if (status === 'CONVERTED' && userId) {
      data.convertedById = userId;
      data.convertedAt = new Date();
    }

    return this.prisma.checkoutLead.update({ where: { id }, data });
  }

  async convertToOrder(
    id: string,
    userId: string,
    overrides?: ConvertOrderDto,
  ) {
    const lead = await this.findOne(id);
    if (lead.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING leads can be converted');
    }

    const items = overrides?.items || (lead.items as any[]) || [];
    if (items.length === 0) {
      throw new BadRequestException('Lead has no items to convert');
    }

    let guestPhone = overrides?.guestPhone ?? lead.phone ?? undefined;
    if (guestPhone) {
      const normalized = normalizePhone(guestPhone);
      if (!normalized) throw new BadRequestException('Invalid phone number');
      guestPhone = normalized;
    }

    const initialStatus = await this.prisma.orderStatus.findFirst({
      where: { isInitial: true },
    });
    if (!initialStatus)
      throw new BadRequestException('No initial order status');

    const displayId = await this.generateOrderDisplayId();

    const userData = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const userName = userData
      ? `${userData.firstName} ${userData.lastName}`.trim()
      : userId;

    const guestName = overrides?.guestName ?? lead.name;
    let resolvedCustomerId: string | null = null;
    if (guestPhone && guestName) {
      const customer = await this.customersService.findOrCreateCustomer(
        guestPhone,
        guestName,
      );
      resolvedCustomerId = customer.id;
    }

    const order = await this.prisma.order.create({
      data: {
        displayId,
        customerId: resolvedCustomerId,
        statusId: initialStatus.id,
        subtotal: 0,
        total: 0,
        shippingAddress: overrides?.shippingAddress ?? (lead.address as any),
        guestName,
        guestPhone,
        items: {
          create: items.map((i: any) => ({
            productId: i.productId,
            comboId: i.comboId,
            quantity: i.quantity || 1,
            price: i.price || 0,
          })),
        },
        timeline: [
          {
            status: initialStatus.name,
            timestamp: new Date().toISOString(),
            note: `Converted from lead ${lead.displayId || id} by ${userName}`,
            changedBy: userId,
          },
        ] as any,
      },
    });

    const subtotal = items.reduce(
      (s: number, i: any) => s + (i.price || 0) * (i.quantity || 1),
      0,
    );
    await this.prisma.order.update({
      where: { id: order.id },
      data: { subtotal, total: subtotal },
    });

    const pm = overrides?.paymentMethod ?? lead.paymentMethod;
    if (pm) {
      const isPgw = pm === 'bkash_pgw';
      await this.prisma.payment.create({
        data: {
          orderId: order.id,
          gatewayCode: pm,
          amount: subtotal,
          status: isPgw ? PaymentStatus.PAID : PaymentStatus.PENDING,
          verifiedBy: isPgw ? 'system' : null,
          verifiedAt: isPgw ? new Date() : null,
        },
      });
    }

    await this.prisma.checkoutLead.update({
      where: { id },
      data: {
        status: 'CONVERTED',
        convertedAt: new Date(),
        convertedById: userId,
        convertedOrderId: order.id,
      },
    });

    if (guestPhone) {
      await this.prisma.checkoutLead.updateMany({
        where: { phone: guestPhone, status: 'PENDING', id: { not: id } },
        data: {
          status: 'CONVERTED',
          convertedOrderId: order.id,
          convertedAt: new Date(),
        },
      });
    }

    return this.prisma.order.findUnique({
      where: { id: order.id },
      include: {
        status: true,
        items: {
          include: { product: { select: { id: true, name: true } } },
        },
      },
    });
  }

  async assign(id: string, assignedToId: string | null, userId: string) {
    const lead = await this.findOne(id);
    return this.prisma.checkoutLead.update({
      where: { id },
      data: {
        assignedToId,
        assignedById: userId,
        assignedAt: new Date(),
      },
    });
  }

  async bulkAssign(ids: string[], assignedToId: string | null, userId: string) {
    await this.prisma.checkoutLead.updateMany({
      where: { id: { in: ids } },
      data: {
        assignedToId,
        assignedById: userId,
        assignedAt: new Date(),
      },
    });
    return { message: `${ids.length} leads assigned` };
  }

  async bulkStatus(ids: string[], status: string) {
    await this.prisma.checkoutLead.updateMany({
      where: { id: { in: ids }, status: { not: 'CONVERTED' } },
      data: { status },
    });
    return { message: `${ids.length} leads updated to ${status}` };
  }

  async getSummary() {
    const [pending, converted, notConverted, deleted] = await Promise.all([
      this.prisma.checkoutLead.count({ where: { status: 'PENDING' } }),
      this.prisma.checkoutLead.count({ where: { status: 'CONVERTED' } }),
      this.prisma.checkoutLead.count({ where: { status: 'NOT_CONVERTED' } }),
      this.prisma.checkoutLead.count({ where: { status: 'DELETED' } }),
    ]);
    return {
      pending,
      converted,
      notConverted,
      deleted,
      total: pending + converted + notConverted + deleted,
    };
  }

  private async leadDisplayId(): Promise<string> {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yy}${mm}${dd}`;
    const prefix = `LEAD-${dateStr}`;

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: `LEAD-${dateStr}` },
        create: { date: `LEAD-${dateStr}`, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      return `${prefix}-${String(counter.seq).padStart(4, '0')}`;
    });
  }

  private async generateOrderDisplayId(): Promise<string> {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const prefix = `ORD-${yy}${mm}${dd}`;
    const last = await this.prisma.order.findFirst({
      where: { displayId: { startsWith: prefix } },
      orderBy: { displayId: 'desc' },
      select: { displayId: true },
    });
    const nextNo = last
      ? parseInt(last.displayId.split('-').pop() || '0') + 1
      : 1;
    return `${prefix}-${String(nextNo).padStart(4, '0')}`;
  }
}
