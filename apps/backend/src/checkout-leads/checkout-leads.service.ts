import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { TrackingService } from '../tracking/tracking.service';
import { normalizePhone } from '../common/utils/phone-utils';
import { ConvertOrderDto } from './dto/convert-order.dto';

@Injectable()
export class CheckoutLeadsService {
  private readonly logger = new Logger(CheckoutLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly tracking: TrackingService,
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
    fbp?: string;
    fbc?: string;
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

    const lead = await this.prisma.checkoutLead.create({
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

    // Fire Lead event for new leads (with 1hr cooldown per phone)
    this.fireLeadEvent(lead, dto).catch((err) => {
      this.logger.error('Failed to fire lead event:', err);
    });

    return lead;
  }

  private async fireLeadEvent(
    lead: any,
    dto: { phone?: string; name?: string; fbp?: string; fbc?: string },
  ) {
    const phone = lead.phone || dto.phone;
    if (!phone) return;

    // 1hr cooldown: skip if same phone had Lead event in last 60 min
    const recent = await this.prisma.trackingEvent.findFirst({
      where: {
        eventType: 'lead',
        orderId: phone,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recent) return;

    const items = Array.isArray(lead.items) ? (lead.items as any[]) : [];
    const estimatedTotal = items.reduce(
      (s: number, i: any) => s + (i.price || 0) * (i.quantity || 1),
      0,
    );

    await this.tracking.track({
      eventName: 'lead',
      eventId: `lead_${lead.id}`,
      actionSource: 'website',
      userData: {
        phone,
        name: lead.name || dto.name || undefined,
        fbp: dto.fbp || undefined,
        fbc: dto.fbc || undefined,
        country: 'BD',
      },
      customData: {
        value: estimatedTotal || undefined,
        currency: 'BDT',
        lead_id: lead.id,
      },
    });

    // Track event in DB for cooldown tracking
    try {
      await this.prisma.trackingEvent.create({
        data: {
          eventId: `lead_${lead.id}`,
          orderId: phone,
          eventType: 'lead',
          fbp: dto.fbp,
          fbc: dto.fbc,
          status: 'sent',
        },
      });
    } catch {
      // non-critical
    }
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
    clientIp?: string,
  ) {
    const lead = await this.findOne(id);
    if (lead.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING leads can be converted');
    }

    const items =
      overrides?.items ||
      (Array.isArray(lead.items) ? (lead.items as any[]) : []);
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

    const userData = await this.prisma.userProfile.findUnique({
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
        clientIp,
      );
      resolvedCustomerId = customer.id;
    }

    const shippingCharge = overrides?.shippingCharge ?? 0;
    const discountAmount = overrides?.discount ?? 0;
    const discountType = overrides?.discountType ?? 'flat';

    let shippingAddress = overrides?.shippingAddress ?? (lead.address as any);
    if (overrides?.district || overrides?.thana) {
      shippingAddress = {
        ...(typeof shippingAddress === 'object' ? shippingAddress : {}),
        district: overrides.district,
        thana: overrides.thana,
        ...(overrides.shippingAddress
          ? typeof overrides.shippingAddress === 'object'
            ? overrides.shippingAddress
            : {}
          : {}),
      };
    }

    const subtotal = items.reduce(
      (s: number, i: any) => s + (i.price || 0) * (i.quantity || 1),
      0,
    );
    const effectiveDiscount =
      discountType === 'percentage'
        ? subtotal * (discountAmount / 100)
        : discountAmount;
    const total = Math.max(0, subtotal + shippingCharge - effectiveDiscount);

    const pm = overrides?.paymentMethod ?? lead.paymentMethod;

    let fullOrder: any = null;

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          displayId,
          customerId: resolvedCustomerId,
          statusId: initialStatus.id,
          subtotal,
          total,
          shippingCharge,
          discount: discountAmount,
          discountType,
          shippingAddress,
          customerNotes: overrides?.customerNotes ?? null,
          officeNotes: overrides?.officeNotes ?? null,
          guestName,
          guestPhone,
          items: {
            create: items.map((i: any) => ({
              productId: i.productId,
              comboId: i.comboId,
              variantId: i.variantId,
              quantity: i.quantity || 1,
              price: i.price || 0,
            })),
          },
          salesChannel: (overrides?.salesChannel || 'CALL') as any,
          paymentOptionType:
            overrides?.paymentMode === 'cod'
              ? 'CASH_ON_DELIVERY'
              : overrides?.paymentMode === 'partial'
                ? 'PARTIAL_PAYMENT'
                : overrides?.paymentMode === 'full'
                  ? 'FULL_PAYMENT'
                  : undefined,
          partialAmount:
            overrides?.paymentMode === 'partial'
              ? (overrides.partialAmount ?? null)
              : undefined,
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

      if (pm) {
        const paymentAmount =
          overrides?.paymentMode === 'partial' && overrides?.partialAmount
            ? overrides.partialAmount
            : total;
        const isPgw = pm === 'bkash_pgw';
        await tx.payment.create({
          data: {
            orderId: order.id,
            gatewayCode: pm,
            amount: paymentAmount,
            status: isPgw ? PaymentStatus.PAID : PaymentStatus.PENDING,
            verifiedBy: isPgw ? 'system' : null,
            verifiedAt: isPgw ? new Date() : null,
          },
        });
      }

      await tx.checkoutLead.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
          convertedById: userId,
          convertedOrderId: order.id,
        },
      });

      if (guestPhone) {
        await tx.checkoutLead.updateMany({
          where: { phone: guestPhone, status: 'PENDING', id: { not: id } },
          data: {
            status: 'CONVERTED',
            convertedOrderId: order.id,
            convertedAt: new Date(),
          },
        });
      }

      fullOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          customer: true,
          status: true,
          items: {
            include: { product: { select: { id: true, name: true } } },
          },
        },
      });
    });

    // Fire offline Purchase for lead-converted order
    if (fullOrder) {
      this.fireOfflinePurchase(fullOrder, lead).catch((err) => {
        this.logger.error('Failed to fire offline purchase:', err);
      });
    }

    return fullOrder;
  }

  private async fireOfflinePurchase(order: any, lead: any) {
    let email = '';
    let phone = '';
    let firstName = '';
    let lastName = '';

    if (order.customer) {
      email = order.customer.email || '';
      firstName = order.customer.name || '';
      lastName = '';
      phone = order.customer.phone || '';
    }
    if (!phone) phone = order.guestPhone || '';
    if (!firstName) firstName = order.guestName || '';

    const itemsList = (order.items as any[]) || [];
    const totalValue = Number(order.total || 0);

    // Use same eventId pattern as main purchase flow so Meta dedups
    // if firePurchaseValidated fires later for the same order
    await this.tracking.track({
      eventName: 'purchase',
      eventId: `purchase_${order.id}`,
      eventTime: Math.floor(new Date(order.createdAt).getTime() / 1000),
      actionSource: 'physical_store',
      userData: {
        email,
        phone,
        name: firstName || undefined,
        lastName: lastName || undefined,
        country: 'BD',
      },
      customData: {
        value: totalValue,
        currency: 'BDT',
        content_ids: itemsList
          .map((i: any) => i.productId || i.comboId || '')
          .filter(Boolean),
        order_id: order.id,
        lead_id: lead.id,
        source: 'lead_conversion',
        num_items: itemsList.reduce(
          (s: number, i: any) => s + (i.quantity || 0),
          0,
        ),
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
    const { count } = await this.prisma.checkoutLead.updateMany({
      where: { id: { in: ids } },
      data: {
        assignedToId,
        assignedById: userId,
        assignedAt: new Date(),
      },
    });
    return { message: `${count} leads assigned` };
  }

  async bulkStatus(ids: string[], status: string) {
    const { count } = await this.prisma.checkoutLead.updateMany({
      where: { id: { in: ids }, status: { not: 'CONVERTED' } },
      data: { status },
    });
    return { message: `${count} leads updated to ${status}` };
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
    const dateStr = `${yy}${mm}${dd}`;
    const prefix = `ORD-${dateStr}`;

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: dateStr },
        create: { date: dateStr, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      return `${prefix}-${String(counter.seq).padStart(4, '0')}`;
    });
  }
}
