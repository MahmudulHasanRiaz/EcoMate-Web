import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { CustomersService } from '../customers/customers.service';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
} from './dto/order.dto';
import { buildTrackingUrl } from '../courier-manager/courier-webhook.service';
import { normalizePhone } from '../common/utils/phone-utils';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
    private readonly customersService: CustomersService,
  ) {}

  private transformOrder(order: any) {
    if (!order) return order;
    return {
      ...order,
      trackingUrl: buildTrackingUrl(
        order.courierService,
        order.courierTrackingCode,
        order.courierConsignmentId,
      ),
    };
  }

  private async generateDisplayId(): Promise<string> {
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

  private recalculate(
    items: { price: number; quantity: number }[],
    shipping: number,
    discount: number,
    discountType = 'flat',
  ) {
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const effectiveDiscount = discountType === 'percentage'
      ? subtotal * (discount / 100)
      : discount;
    return { subtotal, total: Math.max(0, subtotal + shipping - effectiveDiscount) };
  }

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    statusId?: string;
    courier?: string;
    assignedToId?: string;
    dateFrom?: string;
    dateTo?: string;
    sort?: string;
    order?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: any = {};
    if (query.search) {
      where.OR = [
        { displayId: { contains: query.search, mode: 'insensitive' } },
        {
          customer: {
            firstName: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          customer: {
            lastName: { contains: query.search, mode: 'insensitive' },
          },
        },
        { customer: { phoneNumber: { contains: query.search } } },
        { guestName: { contains: query.search, mode: 'insensitive' } },
        { guestPhone: { contains: query.search } },
      ];
    }
    if (query.statusId) where.statusId = query.statusId;
    if (query.courier) where.courierService = query.courier;
    if (query.assignedToId === 'unassigned') where.assignedToId = null;
    else if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { [query.sort || 'createdAt']: query.order || 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
            },
          },
          status: true,
          items: {
            include: {
              product: { select: { id: true, name: true, images: true } },
            },
          },
          payments: true,
          shipment: true,
          assignee: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      data: data.map((o: any) => this.transformOrder(o)),
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
          },
        },
        status: true,
        shipment: true,
        assignee: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: {
              select: { id: true, name: true, images: true, slug: true },
            },
          },
        },
        payments: {
          include: {
            verifier: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        dispatchLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.transformOrder(order);
  }

  async create(dto: CreateOrderDto) {
    const displayId = await this.generateDisplayId();
    const initialStatus = await this.prisma.orderStatus.findFirst({
      where: { isInitial: true },
    });
    if (!initialStatus)
      throw new BadRequestException('No initial order status configured');

    const { subtotal, total } = this.recalculate(
      dto.items,
      dto.shippingCharge || 0,
      dto.discount || 0,
      dto.discountType,
    );

    const productIds = dto.items
      .filter((i) => i.productId && !i.comboId)
      .map((i) => i.productId!);
    if (productIds.length > 0) {
      const existingProducts = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      const existingIds = new Set(existingProducts.map((p) => p.id));
      const missing = productIds.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Some products no longer exist: ${missing.join(', ')}. Please clear your cart and add products again.`,
        );
      }
    }

    const comboIds = dto.items
      .filter((i) => i.comboId)
      .map((i) => i.comboId!);
    if (comboIds.length > 0) {
      const existingCombos = await this.prisma.combo.findMany({
        where: { id: { in: comboIds } },
        select: { id: true, name: true, items: { select: { productId: true, variantId: true } } },
      });
      const existingIds = new Set(existingCombos.map((c) => c.id));
      const missing = comboIds.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Some combos no longer exist: ${missing.join(', ')}. Please clear your cart and add products again.`,
        );
      }
      const comboMap = new Map(existingCombos.map((c) => [c.id, c]));
      for (const ci of dto.items.filter((i) => i.comboId)) {
        if (!ci.comboSelection) continue;
        const combo = comboMap.get(ci.comboId!)!;
        for (const sub of combo.items) {
          if (!sub.variantId && !ci.comboSelection[sub.productId]) {
            throw new BadRequestException(
              `Product "${sub.productId}" in combo "${combo.name}" requires a variant selection.`,
            );
          }
        }
      }
    }

    if (dto.guestPhone) {
      const normalized = normalizePhone(dto.guestPhone);
      if (!normalized) {
        throw new BadRequestException(
          'Invalid Bangladeshi phone number format. Use 01XXXXXXXXX or +8801XXXXXXXXX.',
        );
      }
      dto.guestPhone = normalized;
    }

    if (dto.guestPhone && dto.guestName && !dto.customerId) {
      const customer = await this.customersService.findOrCreateCustomer(
        dto.guestPhone,
        dto.guestName,
      );
      dto.customerId = customer.id;
    }

    let couponCode: string | null = null;
    if (dto.couponCode) {
      const coupon = await this.prisma.coupon.findUnique({
        where: { code: dto.couponCode },
      });
      if (!coupon || !coupon.isActive) {
        throw new BadRequestException('Invalid or inactive coupon code');
      }
      if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
        throw new BadRequestException('Coupon usage limit reached');
      }
      if (coupon.expiresAt && new Date() > coupon.expiresAt) {
        throw new BadRequestException('Coupon has expired');
      }
      if (coupon.startsAt && new Date() < coupon.startsAt) {
        throw new BadRequestException('Coupon is not yet active');
      }
      if (
        coupon.minOrderValue &&
        Number(subtotal) < Number(coupon.minOrderValue)
      ) {
        throw new BadRequestException(
          `Minimum order value of ${coupon.minOrderValue} required for this coupon`,
        );
      }
      couponCode = coupon.code;
    }

    const order = await this.prisma.order.create({
      data: {
        displayId,
        customerId: dto.customerId ?? null,
        statusId: initialStatus.id,
        subtotal,
        shippingCharge: dto.shippingCharge || 0,
        discount: dto.discount || 0,
        discountType: dto.discountType || 'flat',
        total,
        shippingAddress: {
          ...(typeof dto.shippingAddress === 'object' && dto.shippingAddress ? dto.shippingAddress : {}),
          district: dto.district,
          thana: dto.thana,
        },
        customerNotes: dto.customerNotes,
        officeNotes: dto.officeNotes,
        guestName: dto.guestName,
        guestPhone: dto.guestPhone,
        paymentMethod: dto.paymentMethod,
        paymentMode: dto.paymentMode || 'cod',
        partialAmount: dto.partialAmount,
        items: {
          create: dto.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            comboId: i.comboId,
            comboSelection: i.comboSelection || undefined,
            quantity: i.quantity,
            price: i.price,
          })),
        },
        timeline: [
          {
            status: initialStatus.name,
            timestamp: new Date().toISOString(),
            note: 'Order created',
          },
        ] as any,
      },
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true },
        },
        status: true,
        items: {
          include: {
            product: { select: { id: true, name: true, images: true } },
          },
        },
      },
    });

    if (dto.paymentMethod) {
      const paymentAmount = dto.paymentMode === 'partial' && dto.partialAmount
        ? dto.partialAmount
        : total;
      await this.prisma.payment.create({
        data: {
          orderId: order.id,
          method: dto.paymentMethod,
          amount: paymentAmount,
          status: 'pending',
        },
      });
    }

    const phoneToClose = dto.guestPhone || order.customer?.phoneNumber;
    if (phoneToClose) {
      await this.prisma.checkoutLead.updateMany({
        where: { phone: phoneToClose, status: 'PENDING' },
        data: {
          status: 'CONVERTED',
          convertedOrderId: order.id,
          convertedAt: new Date(),
        },
      });
    }

    this.tracking.track({
      eventName: 'purchase',
      customData: {
        value: Number(total),
        currency: 'BDT',
        content_ids: dto.items.map(i => i.productId || i.comboId).filter(Boolean),
        num_items: dto.items.reduce((s, i) => s + i.quantity, 0),
      },
    }).catch(() => {});

    if (couponCode) {
      await this.prisma.coupon.update({
        where: { code: couponCode },
        data: { usedCount: { increment: 1 } },
      });
    }

    await this.deductStock(dto.items, displayId);

    return order;
  }

  async updateOrder(id: string, dto: UpdateOrderDto) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const timeline = [...((order.timeline as any[]) || [])];
    const now = new Date().toISOString();

    if (
      dto.shippingCharge !== undefined &&
      Number(dto.shippingCharge) !== Number(order.shippingCharge)
    ) {
      timeline.push({
        type: 'shipping',
        visibility: 'public',
        timestamp: now,
        oldValue: Number(order.shippingCharge),
        newValue: Number(dto.shippingCharge),
        note: `Shipping: ৳${Number(order.shippingCharge)} → ৳${Number(dto.shippingCharge)}`,
      });
    }

    if (
      dto.discount !== undefined &&
      Number(dto.discount) !== Number(order.discount)
    ) {
      timeline.push({
        type: 'discount',
        visibility: 'public',
        timestamp: now,
        oldValue: Number(order.discount),
        newValue: Number(dto.discount),
        discountType: dto.discountType || order.discountType,
        note: `Discount changed to ৳${Number(dto.discount)} (${dto.discountType || order.discountType})`,
      });
    }

    if (dto.items && dto.items.length > 0) {
      await this.prisma.orderItem.deleteMany({ where: { orderId: id } });
      await this.prisma.orderItem.createMany({
        data: dto.items.map((i) => ({
          orderId: id,
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          price: i.price,
        })),
      });
      const oldItems = order.items
        .map((i) => `${i.product?.name || 'Unknown'} ×${i.quantity}`)
        .join(', ');
      const newItems = dto.items
        .map((i) => `${i.productId} ×${i.quantity}`)
        .join(', '); // will resolve below
      timeline.push({
        type: 'items',
        visibility: 'public',
        timestamp: now,
        note: 'Order items updated',
      });
    }

    if (dto.customerInfo && order.customerId) {
      await this.prisma.user.update({
        where: { id: order.customerId },
        data: dto.customerInfo,
      });
    }

    const data: any = {};
    data.timeline = timeline;
    if (dto.shippingCharge !== undefined)
      data.shippingCharge = dto.shippingCharge;
    if (dto.discount !== undefined) data.discount = dto.discount;
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.customerNotes !== undefined) data.customerNotes = dto.customerNotes;
    if (dto.officeNotes !== undefined) data.officeNotes = dto.officeNotes;
    if (dto.shippingAddress !== undefined)
      data.shippingAddress = dto.shippingAddress;

    const currentItems =
      dto.items && dto.items.length > 0
        ? dto.items
        : order.items.map((i) => ({
            price: Number(i.price),
            quantity: i.quantity,
          }));
    const shipping =
      data.shippingCharge !== undefined
        ? data.shippingCharge
        : Number(order.shippingCharge);
    const discount =
      data.discount !== undefined ? data.discount : Number(order.discount);
    const discountType = dto.discountType || order.discountType || 'flat';
    const { subtotal, total } = this.recalculate(
      currentItems,
      shipping,
      discount,
      discountType,
    );
    data.subtotal = subtotal;
    data.total = total;

    return this.prisma.order.update({
      where: { id },
      data,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
          },
        },
        status: true,
        shipment: true,
        assignee: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: {
              select: { id: true, name: true, images: true, slug: true },
            },
          },
        },
        payments: true,
      },
    });
  }

  async addNote(
    orderId: string,
    note: string,
    visibility: 'public' | 'private',
    userId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const timeline = [
      ...((order.timeline as any[]) || []),
      {
        type: 'note',
        visibility,
        timestamp: new Date().toISOString(),
        note,
        addedBy: userId,
      },
    ];

    return this.prisma.order.update({
      where: { id: orderId },
      data: { timeline: timeline as any },
      include: {
        status: true,
        customer: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { status: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const newStatus = await this.prisma.orderStatus.findUnique({
      where: { id: dto.statusId },
    });
    if (!newStatus) throw new NotFoundException('Status not found');

    const allowedIds = (order.status.nextStatuses as string[]) || [];
    if (!allowedIds.includes(dto.statusId)) {
      throw new BadRequestException(
        `Cannot transition from "${order.status.name}" to "${newStatus.name}"`,
      );
    }

    const timeline = [
      ...((order.timeline as any[]) || []),
      {
        status: newStatus.name,
        timestamp: new Date().toISOString(),
        note: dto.note || '',
        changedBy: userId,
      },
    ];

    const updated = await this.prisma.order.update({
      where: { id },
      data: { statusId: dto.statusId, timeline: timeline as any },
      include: {
        status: true,
        customer: { select: { id: true, firstName: true, lastName: true } },
        payments: true,
      },
    });

    if (newStatus.name === 'Delivered') {
      const codPayment = updated.payments?.find(
        (p) => p.method === 'cod' && p.status !== 'verified',
      );
      if (codPayment) {
        await this.prisma.payment.update({
          where: { id: codPayment.id },
          data: {
            status: 'verified',
            verifiedBy: userId,
            verifiedAt: new Date(),
          },
        });
      }
    }

    return updated;
  }

  async addItem(orderId: string, dto: UpdateOrderItemDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    await this.prisma.orderItem.create({
      data: {
        orderId,
        productId: dto.productId,
        variantId: dto.variantId,
        quantity: dto.quantity,
        price: dto.price,
      },
    });

    const items = [
      ...order.items.map((i) => ({
        price: Number(i.price),
        quantity: i.quantity,
      })),
      { price: dto.price, quantity: dto.quantity },
    ];
    const { subtotal, total } = this.recalculate(
      items,
      Number(order.shippingCharge),
      Number(order.discount),
      order.discountType || 'flat',
    );
    return this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, total },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, images: true, slug: true },
            },
          },
        },
      },
    });
  }

  async removeItem(orderId: string, itemId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    await this.prisma.orderItem.delete({ where: { id: itemId } });

    const remaining = order.items
      .filter((i) => i.id !== itemId)
      .map((i) => ({ price: Number(i.price), quantity: i.quantity }));
    const { subtotal, total } = this.recalculate(
      remaining,
      Number(order.shippingCharge),
      Number(order.discount),
      order.discountType || 'flat',
    );
    return this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, total },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, images: true, slug: true },
            },
          },
        },
      },
    });
  }

  async bulkOrders(ids: string[]) {
    if (!ids?.length || ids.length > 500) return [];
    return this.prisma.order.findMany({
      where: { id: { in: ids } },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
          },
        },
        status: true,
        items: {
          include: {
            product: { select: { id: true, name: true, images: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async bulkStatusChange(ids: string[], statusId: string) {
    const targetStatus = await this.prisma.orderStatus.findUnique({
      where: { id: statusId },
    });
    if (!targetStatus) throw new BadRequestException('Status not found');

    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      select: { id: true, statusId: true, status: { select: { nextStatuses: true } } },
    });

    const validIds: string[] = [];
    const skipped: string[] = [];
    for (const order of orders) {
      const allowed = (order.status.nextStatuses as string[]) || [];
      if (allowed.includes(statusId)) {
        validIds.push(order.id);
      } else {
        skipped.push(order.id);
      }
    }

    if (validIds.length > 0) {
      await this.prisma.order.updateMany({
        where: { id: { in: validIds } },
        data: { statusId },
      });
    }

    return {
      updated: validIds.length,
      skipped: skipped.length,
      status: targetStatus.name,
    };
  }

  async bulkDispatch(courier: string, ids: string[], _userId: string) {
    const { CourierManagerService } =
      await import('../courier-manager/courier-manager.service.js');
    const mgr = new CourierManagerService(this.prisma);
    return mgr.dispatch(courier, ids);
  }

  async bulkAssign(ids: string[], assignedToId: string | null) {
    const data: any = { assignedToId };
    if (assignedToId) data.assignedAt = new Date();
    else data.assignedAt = null;
    await this.prisma.order.updateMany({ where: { id: { in: ids } }, data });
    return { updated: ids.length };
  }

  async getStaff() {
    return this.prisma.user.findMany({
      where: {
        role: { in: ['admin', 'manager', 'cashier', 'superadmin'] },
        status: 'active',
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { firstName: 'asc' },
    });
  }

  async rotateViewToken(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    const viewToken = randomUUID();
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { viewToken },
      select: { id: true, viewToken: true, displayId: true },
    });
    return updated;
  }

  async cancelByCustomer(orderId: string, token: string) {
    if (!token) throw new ForbiddenException('View token is required');
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order || order.viewToken !== token) {
      throw new NotFoundException('Order not found');
    }
    if (order.status.name !== 'Pending') {
      throw new BadRequestException(
        `Order in "${order.status.name}" status cannot be cancelled`,
      );
    }
    const cancelled = await this.prisma.orderStatus.findFirst({
      where: { name: 'Cancelled' },
    });
    if (!cancelled) {
      throw new BadRequestException('Cancelled status not configured');
    }
    const timeline = [
      ...((order.timeline as any[]) || []),
      {
        status: 'Cancelled',
        timestamp: new Date().toISOString(),
        note: 'Cancelled by customer',
      },
    ];
    return this.prisma.order.update({
      where: { id: orderId },
      data: { statusId: cancelled.id, timeline: timeline as any },
      include: { status: true },
    });
  }

  async backfillViewTokens() {
    const orders = await this.prisma.order.findMany({
      where: { viewToken: null },
      select: { id: true },
    });
    let updated = 0;
    for (const o of orders) {
      await this.prisma.order.update({
        where: { id: o.id },
        data: { viewToken: randomUUID() },
      });
      updated += 1;
    }
    return { updated, total: orders.length };
  }

  private async deductStock(
    items: {
      productId?: string;
      variantId?: string;
      comboId?: string;
      comboSelection?: Record<string, string>;
      quantity: number;
    }[],
    displayId: string,
  ) {
    const standaloneProductIds = items
      .filter((i) => i.productId && !i.comboId)
      .map((i) => i.productId!);
    const standaloneVariantIds = items
      .filter((i) => i.variantId && !i.comboId)
      .map((i) => i.variantId!);

    let products = standaloneProductIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: standaloneProductIds }, manageStock: true },
          select: { id: true, type: true, stock: true, manageStock: true },
        })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    let variants = standaloneVariantIds.length > 0
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: standaloneVariantIds }, product: { manageStock: true } },
          select: { id: true, stock: true, productId: true },
        })
      : [];
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    for (const item of items) {
      if (item.comboId) {
        const combo = await this.prisma.combo.findUnique({
          where: { id: item.comboId },
          include: { items: true },
        });
        if (!combo) continue;
        for (const ci of combo.items) {
          const qty = ci.quantity * item.quantity;
          const effectiveVariantId = ci.variantId
            || (item.comboSelection?.[ci.productId]) // flexible variant choice
            || null;

          if (effectiveVariantId) {
            if (!variantMap.has(effectiveVariantId)) {
              const v = await this.prisma.productVariant.findUnique({
                where: { id: effectiveVariantId },
                select: { id: true, stock: true, productId: true },
              });
              if (v) variantMap.set(v.id, v);
            }
            const v = variantMap.get(effectiveVariantId);
            if (v && v.stock < qty) {
              throw new BadRequestException(
                `Insufficient stock for variant of product "${ci.productId}". Available: ${v.stock}, requested: ${qty}.`,
              );
            }
            await this.prisma.productVariant.update({
              where: { id: effectiveVariantId },
              data: { stock: { decrement: qty } },
            });
          }

          if (!productMap.has(ci.productId)) {
            const p = await this.prisma.product.findUnique({
              where: { id: ci.productId },
              select: { id: true, type: true, stock: true, manageStock: true },
            });
            if (p) productMap.set(p.id, p);
          }
          const p = productMap.get(ci.productId);
          if (p && p.manageStock && p.stock < qty) {
            throw new BadRequestException(
              `Insufficient stock for product "${ci.productId}". Available: ${p.stock}, requested: ${qty}.`,
            );
          }
          if (p && p.manageStock) {
            await this.prisma.product.update({
              where: { id: ci.productId },
              data: { stock: { decrement: qty } },
            });
          }
          await this.prisma.inventoryLog.create({
            data: {
              productId: ci.productId,
              variantId: effectiveVariantId,
              comboId: item.comboId,
              quantity: -qty,
              type: 'combo_order',
              reason: `Combo in Order ${displayId}`,
              createdAt: new Date(),
            },
          });
        }
      } else {
        const variant = item.variantId ? variantMap.get(item.variantId) : null;
        if (variant && variant.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product variant. Available: ${variant.stock}, requested: ${item.quantity}.`,
          );
        }
        if (item.variantId) {
          await this.prisma.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { decrement: item.quantity } },
          });
        }

        const product = item.productId ? productMap.get(item.productId) : null;
        if (product && product.manageStock && (!item.variantId || product.type === 'simple') && product.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product "${item.productId}". Available: ${product.stock}, requested: ${item.quantity}.`,
          );
        }
        if (product && product.manageStock && (!item.variantId || product.type === 'simple')) {
          await this.prisma.product.update({
            where: { id: item.productId! },
            data: { stock: { decrement: item.quantity } },
          });
        }

        await this.prisma.inventoryLog.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            quantity: -item.quantity,
            type: 'order_placed',
            reason: `Order ${displayId}`,
            createdAt: new Date(),
          },
        });
      }
    }
  }
}
