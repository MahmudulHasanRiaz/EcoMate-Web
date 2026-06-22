import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { CustomersService } from '../customers/customers.service';
import { OrdersEventService } from './orders-event.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
  CustomerInfoDto,
} from './dto/order.dto';
import { PaymentStatus, PaymentOptionType, Prisma } from '@prisma/client';
import { buildTrackingUrl } from '../courier-manager/courier-webhook.service';
import { normalizePhone } from '../common/utils/phone-utils';
import { BlockedEntriesService } from '../blocked-entries/blocked-entries.service';
import { SecurityService } from '../security/security.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
    private readonly customersService: CustomersService,
    private readonly events: OrdersEventService,
    private readonly inventoryService: InventoryService,
    private readonly blockedEntries: BlockedEntriesService,
    private readonly security: SecurityService,
  ) {}

  private parseTimeline(timeline: unknown): any[] {
    return Array.isArray(timeline) ? timeline : [];
  }

  private transformOrder(order: any) {
    if (!order) return order;
    return {
      ...order,
      timeline: Array.isArray(order.timeline) ? order.timeline : [],
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

  private recalculate(
    items: { price: number; quantity: number }[],
    shipping: number,
    discount: number,
    discountType = 'flat',
  ) {
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const effectiveDiscount =
      discountType === 'percentage' ? subtotal * (discount / 100) : discount;
    return {
      subtotal,
      total: Math.max(0, subtotal + shipping - effectiveDiscount),
    };
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
      const normalizedPhone = normalizePhone(query.search);
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
        { customer: { phoneNumber: { contains: normalizedPhone || query.search } } },
        { guestName: { contains: query.search, mode: 'insensitive' } },
        { guestPhone: { contains: normalizedPhone || query.search } },
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
    const statsWhere = { ...where };
    delete statsWhere.statusId;

    const [data, total, stats] = await Promise.all([
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
      this.prisma.order.groupBy({
        by: ['statusId'],
        where: statsWhere,
        _count: true,
      }),
    ]);

    const statusCounts = stats.reduce((acc, curr) => {
      acc[curr.statusId] = curr._count;
      return acc;
    }, {} as Record<string, number>);

    return {
      data: data.map((o: any) => this.transformOrder(o)),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
        statusCounts,
      },
    };
  }

  async findMyOrders(userId: string, query: { page?: number; perPage?: number; status?: string }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: any = { customerId: userId };
    if (query.status) {
      where.status = { name: { equals: query.status, mode: 'insensitive' } };
    }
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          status: true,
          items: {
            include: {
              product: { select: { id: true, name: true, images: true, slug: true } },
            },
          },
          payments: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      data: data.map((o: any) => this.transformOrder(o)),
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findMyOrderById(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId: userId },
      include: {
        status: true,
        shipment: true,
        items: {
          include: {
            product: { select: { id: true, name: true, images: true, slug: true } },
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

  async findOne(id: string, opts: { token?: string; userId?: string } = {}) {
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
    if (!opts.userId && (!opts.token || order.viewToken !== opts.token)) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (!order.createdAt || new Date(order.createdAt) < fiveMinAgo) {
        throw new NotFoundException('Order not found');
      }
    }
    return this.transformOrder(order);
  }

  async create(dto: CreateOrderDto, clientIp?: string) {
    const displayId = await this.generateDisplayId();
    const initialStatus = await this.prisma.orderStatus.findFirst({
      where: { isInitial: true },
    });
    if (!initialStatus)
      throw new BadRequestException('No initial order status configured');

    if (dto.guestPhone) {
      const normalized = normalizePhone(dto.guestPhone);
      if (!normalized) {
        throw new BadRequestException(
          'Invalid Bangladeshi phone number format. Use 01XXXXXXXXX or +8801XXXXXXXXX.',
        );
      }
      dto.guestPhone = normalized;
    }

    if (clientIp) {
      const orderBlockIp = await this.blockedEntries.findOrderBlockedIp(
        clientIp,
      );
      if (orderBlockIp) {
        throw new BadRequestException(
          'Orders from your IP address are temporarily restricted. Please contact support.',
        );
      }
    }

    const blockedPhone = dto.guestPhone
      ? await this.blockedEntries.findBlockedPhone(dto.guestPhone)
      : null;
    if (blockedPhone) {
      throw new BadRequestException(
        'This phone number has been blocked. Please contact support.',
      );
    }

    if (dto.guestPhone && !dto.customerId) {
      const isBlocked = await this.customersService.isPhoneBlocked(
        dto.guestPhone,
      );
      if (isBlocked) {
        throw new BadRequestException(
          'This phone number has been blocked. Please contact support.',
        );
      }
    }

    if (dto.guestPhone && dto.guestName && !dto.customerId) {
      const customer = await this.customersService.findOrCreateCustomer(
        dto.guestPhone,
        dto.guestName,
      );
      dto.customerId = customer.id;
    }

    if (dto.customerId) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.customerId },
        select: { status: true },
      });
      if (user?.status === 'suspended') {
        throw new BadRequestException(
          'This account has been blocked. Please contact support.',
        );
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      // Fetch and validate database prices and active statuses
      const productIds = Array.from(
        new Set(
          dto.items
            .filter((i) => i.productId)
            .map((i) => i.productId!),
        ),
      );
      const products =
        productIds.length > 0
          ? await tx.product.findMany({
              where: { id: { in: productIds } },
              select: {
                id: true,
                basePrice: true,
                salePrice: true,
                isActive: true,
              },
            })
          : [];
      const productMap = new Map(products.map((p) => [p.id, p]));

      const variantIds = Array.from(
        new Set(
          dto.items
            .filter((i) => i.variantId)
            .map((i) => i.variantId!),
        ),
      );
      const variants =
        variantIds.length > 0
          ? await tx.productVariant.findMany({
              where: { id: { in: variantIds } },
              select: { id: true, price: true, isActive: true, productId: true },
            })
          : [];
      const variantMap = new Map(variants.map((v) => [v.id, v]));

      const comboIds = Array.from(
        new Set(
          dto.items
            .filter((i) => i.comboId)
            .map((i) => i.comboId!),
        ),
      );
      const combos =
        comboIds.length > 0
          ? await tx.combo.findMany({
              where: { id: { in: comboIds } },
              select: {
                id: true,
                basePrice: true,
                salePrice: true,
                isActive: true,
                name: true,
                items: { select: { productId: true, variantId: true } },
              },
            })
          : [];
      const comboMap = new Map(combos.map((c) => [c.id, c]));

      for (const item of dto.items) {
        if (item.comboId) {
          const combo = comboMap.get(item.comboId);
          if (!combo) {
            throw new BadRequestException(`Combo ${item.comboId} not found`);
          }
          if (!combo.isActive) {
            throw new BadRequestException(
              `Combo "${combo.name}" is no longer active`,
            );
          }
          item.price = Number(combo.salePrice ?? combo.basePrice);

          if (item.comboSelection) {
            for (const sub of combo.items) {
              if (!sub.variantId && !item.comboSelection[sub.productId]) {
                throw new BadRequestException(
                  `Product "${sub.productId}" in combo "${combo.name}" requires a variant selection.`,
                );
              }
            }
          }
        } else if (item.variantId) {
          const variant = variantMap.get(item.variantId);
          if (!variant) {
            throw new BadRequestException(`Variant ${item.variantId} not found`);
          }
          if (!variant.isActive) {
            throw new BadRequestException(`Variant is no longer active`);
          }
          const parentProduct = productMap.get(variant.productId);
          if (!parentProduct) {
            throw new BadRequestException(
              `Parent product for variant ${item.variantId} not found`,
            );
          }
          if (!parentProduct.isActive) {
            throw new BadRequestException(`Product is no longer active`);
          }
          item.price =
            variant.price !== null && variant.price !== undefined
              ? Number(variant.price)
              : Number(parentProduct.salePrice ?? parentProduct.basePrice);
        } else if (item.productId) {
          const product = productMap.get(item.productId);
          if (!product) {
            throw new BadRequestException(`Product ${item.productId} not found`);
          }
          if (!product.isActive) {
            throw new BadRequestException(`Product is no longer active`);
          }
          item.price = Number(product.salePrice ?? product.basePrice);
        } else {
          throw new BadRequestException(
            'Each item must have a productId, variantId, or comboId',
          );
        }
      }

      const { subtotal, total } = this.recalculate(
        dto.items,
        dto.shippingCharge || 0,
        dto.discount || 0,
        dto.discountType,
      );

      let couponCode: string | null = null;
      if (dto.couponCode) {
        const coupons = await tx.$queryRawUnsafe<any[]>(
          'SELECT id, "isActive", "maxUses", "usedCount", "expiresAt", "startsAt", "minOrderValue" FROM "Coupon" WHERE code = $1 FOR UPDATE',
          dto.couponCode,
        );
        const coupon = coupons[0];
        if (!coupon || !coupon.isActive) {
          throw new BadRequestException('Invalid or inactive coupon code');
        }
        if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
          throw new BadRequestException('Coupon usage limit reached');
        }
        if (coupon.expiresAt && new Date() > new Date(coupon.expiresAt)) {
          throw new BadRequestException('Coupon has expired');
        }
        if (coupon.startsAt && new Date() < new Date(coupon.startsAt)) {
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
        couponCode = dto.couponCode;
      }

      if (dto.paymentOptionType === 'PARTIAL_PAYMENT') {
        if (
          dto.partialAmount !== undefined &&
          (dto.partialAmount <= 0 || dto.partialAmount > Number(total))
        ) {
          throw new BadRequestException(
            'Partial payment amount must be greater than 0 and not exceed the order total',
          );
        }
      }

      const created = await tx.order.create({
        data: {
          displayId,
          customerId: dto.customerId ?? null,
          statusId: initialStatus.id,
          subtotal,
          shippingCharge: dto.shippingCharge || 0,
          selectedShippingOptionId: dto.selectedShippingOptionId || null,
          discount: dto.discount || 0,
          discountType: dto.discountType || 'flat',
          total,
          viewToken: randomUUID(),
          shippingAddress: {
            ...(typeof dto.shippingAddress === 'object' && dto.shippingAddress
              ? dto.shippingAddress
              : {}),
            district: dto.district,
            thana: dto.thana,
          },
          customerNotes: dto.customerNotes,
          officeNotes: dto.officeNotes,
          guestName: dto.guestName,
          guestPhone: dto.guestPhone,
          paymentOptionType: dto.paymentOptionType,
          paymentStatus:
            dto.paymentOptionType === 'CASH_ON_DELIVERY'
              ? PaymentStatus.UNPAID
              : PaymentStatus.PAYMENT_PENDING,
          partialAmount:
            dto.paymentOptionType === 'PARTIAL_PAYMENT'
              ? dto.partialAmount ?? undefined
              : undefined,
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
      });

      if (dto.paymentOptionType) {
        const paymentAmount =
          dto.paymentOptionType === 'PARTIAL_PAYMENT' && dto.partialAmount
            ? dto.partialAmount
            : total;
        const gatewayCode =
          dto.gatewayCode ||
          (dto.paymentOptionType === 'CASH_ON_DELIVERY' ? 'cash' : undefined);
        if (gatewayCode) {
          await tx.payment.create({
            data: {
              orderId: created.id,
              gatewayCode,
              amount: paymentAmount,
              status: PaymentStatus.PENDING,
            },
          });
        }
      }

      const phoneToClose = dto.guestPhone || created.customer?.phoneNumber;
      if (phoneToClose) {
        await tx.checkoutLead.updateMany({
          where: { phone: phoneToClose, status: 'PENDING' },
          data: {
            status: 'CONVERTED',
            convertedOrderId: created.id,
            convertedAt: new Date(),
          },
        });
      }

      if (couponCode) {
        await tx.coupon.update({
          where: { code: couponCode },
          data: { usedCount: { increment: 1 } },
        });
      }

      await this.deductStock(tx, dto.items, displayId);

      return created;
    });

    this.security.recordOrder(dto.guestPhone || '', clientIp || '');

    this.events.emit({
      type: 'order.created',
      data: { id: order.id, displayId: order.displayId },
    });

    // Fire Purchase if mode is "instant" — re-fetch with relations for tracking payload
    if (initialStatus) {
      const orderWithItems = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: {
          items: {
            include: { product: { select: { id: true, name: true } } },
          },
          payments: true,
        },
      });
      if (orderWithItems) {
        this.firePurchaseIfModeMatches(initialStatus.name, orderWithItems as any, 'system').catch(() => {});
      }
    }

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

    const timeline = [...this.parseTimeline(order.timeline)];
    const now = new Date().toISOString();
    const data: any = {};

    if (
      dto.shippingCharge !== undefined &&
      Number(dto.shippingCharge) !== Number(order.shippingCharge)
    ) {
      data.shippingChargeOverridden = true;
      timeline.push({
        type: 'shipping',
        visibility: 'public',
        timestamp: now,
        oldValue: Number(order.shippingCharge),
        newValue: Number(dto.shippingCharge),
        note: `Shipping: ৳${Number(order.shippingCharge)} → ৳${Number(dto.shippingCharge)}`,
      });
    }

    const discountChanged = dto.discount !== undefined && Number(dto.discount) !== Number(order.discount);
    const discountTypeChanged = dto.discountType !== undefined && dto.discountType !== order.discountType;
    if (discountChanged || discountTypeChanged) {
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
      timeline.push({
        type: 'items',
        visibility: 'public',
        timestamp: now,
        note: 'Order items updated',
      });
    }

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
    data.timeline = timeline;

    if (dto.shippingCharge !== undefined)
      data.shippingCharge = dto.shippingCharge;
    if (dto.selectedShippingOptionId !== undefined)
      data.selectedShippingOptionId = dto.selectedShippingOptionId || null;
    if (dto.discount !== undefined) data.discount = dto.discount;
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.customerNotes !== undefined) data.customerNotes = dto.customerNotes;
    if (dto.officeNotes !== undefined) data.officeNotes = dto.officeNotes;
    if (dto.shippingAddress !== undefined)
      data.shippingAddress = dto.shippingAddress;

    return this.prisma.$transaction(async (tx) => {
      if (dto.items && dto.items.length > 0) {
        // Restock old items
        await this.deductStock(tx, order.items.map(i => ({
          productId: i.productId || undefined,
          variantId: i.variantId || undefined,
          comboId: i.comboId || undefined,
          comboSelection: (i.comboSelection as Record<string, string>) || undefined,
          quantity: i.quantity,
        })), `restock-${order.displayId}`, true);

        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.orderItem.createMany({
          data: dto.items.map((i) => ({
            orderId: id,
            productId: i.productId,
            variantId: i.variantId,
            comboId: i.comboId,
            comboSelection: i.comboSelection || undefined,
            quantity: i.quantity,
            price: i.price,
          })),
        });

        // Deduct stock for new items
        await this.deductStock(tx, dto.items, order.displayId);
      }

      if (dto.customerInfo && order.customerId) {
        const allowedFields: (keyof CustomerInfoDto)[] = [
          'firstName',
          'lastName',
          'phoneNumber',
          'email',
        ];
        const safeData: Record<string, string> = {};
        for (const field of allowedFields) {
          const value = (dto.customerInfo as any)[field];
          if (value !== undefined) {
            safeData[field] = String(value);
          }
        }
        if (safeData.phoneNumber) {
          const normalized = normalizePhone(safeData.phoneNumber);
          if (!normalized) throw new BadRequestException('Invalid phone number');
          safeData.phoneNumber = normalized;
        }
        if (Object.keys(safeData).length > 0) {
          await tx.user.update({
            where: { id: order.customerId },
            data: safeData,
          });
        }
      }

      return tx.order.update({
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
    });
  }

  async addNote(
    orderId: string,
    note: string,
    visibility: 'public' | 'private',
    userId: string,
    performedBy?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        type: 'note',
        visibility,
        timestamp: new Date().toISOString(),
        note,
        performedBy: performedBy || userId,
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

  async updateStatus(id: string, dto: UpdateOrderStatusDto, userId: string, performedBy?: string) {
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
      ...this.parseTimeline(order.timeline),
      {
        status: newStatus.name,
        oldStatus: order.status.name,
        timestamp: new Date().toISOString(),
        note: dto.note || '',
        performedBy: performedBy || userId,
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
        (p) => p.gatewayCode === 'cash' && p.status === PaymentStatus.UNPAID,
      );
      if (codPayment) {
        await this.prisma.payment.update({
          where: { id: codPayment.id },
          data: {
            status: PaymentStatus.PAID,
            verifiedBy: userId,
            verifiedAt: new Date(),
          },
        });
      }
    }

    if (newStatus.name === 'Cancelled') {
      try {
        await this.inventoryService.restockOrderItems(
          id,
          performedBy || userId,
          'cancellation_restock',
        );
      } catch (err) {
        // Log but don't block status change
        this.logger.error(`Failed to restock cancelled order ${id}:`, err);
      }
    }

    this.events.emit({
      type: 'order.status_changed',
      data: {
        id: updated.id,
        displayId: updated.displayId,
        statusId: dto.statusId,
        statusName: newStatus.name,
      },
    });

    if (newStatus.name === 'Confirmed' || newStatus.name === 'Delivered') {
      await this.firePurchaseIfModeMatches(newStatus.name, updated, userId).catch(() => {});
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

  async bulkStatusChange(ids: string[], statusId: string, userId = 'system') {
    const targetStatus = await this.prisma.orderStatus.findUnique({
      where: { id: statusId },
    });
    if (!targetStatus) throw new BadRequestException('Status not found');

    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        statusId: true,
        status: { select: { nextStatuses: true } },
      },
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

      if (targetStatus.name === 'Cancelled') {
        for (const id of validIds) {
          try {
            await this.inventoryService.restockOrderItems(id, userId, 'cancellation_restock');
          } catch (err) {
            this.logger.error(`Failed to restock cancelled order ${id}:`, err);
          }
        }
      }
    }

    return {
      updated: validIds.length,
      skipped: skipped.length,
      failed: 0,
      failedDetails: [],
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

  async findByViewToken(viewTokenOrDisplayId: string) {
    let queryStr = viewTokenOrDisplayId.trim();
    if (queryStr.startsWith('#')) {
      queryStr = queryStr.substring(1).trim();
    }
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { viewToken: queryStr },
          { displayId: { equals: queryStr, mode: 'insensitive' } },
        ],
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
          },
        },
        items: {
          include: {
            product: { select: { name: true, slug: true, images: true } },
          },
        },
        status: true,
        payments: true,
        shipment: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.transformOrder(order);
  }

  async findByPhone(phone: string) {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new BadRequestException('Invalid Bangladeshi phone number format. Use 01XXXXXXXXX or +8801XXXXXXXXX.');
    }

    const orders = await this.prisma.order.findMany({
      where: {
        OR: [
          { guestPhone: normalized },
          { customer: { phoneNumber: normalized } },
        ],
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
          },
        },
        items: {
          include: {
            product: { select: { name: true, slug: true, images: true } },
          },
        },
        status: true,
        payments: true,
        shipment: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => this.transformOrder(order));
  }

  async rotateViewToken(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
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
    if (order.status.name !== 'Pending' && order.status.name !== 'Payment Pending') {
      throw new BadRequestException(
        `Order in "${order.status.name}" status cannot be cancelled`,
      );
    }
    const cancelled = await this.prisma.orderStatus.findFirst({
      where: { name: 'Cancelled' },
      orderBy: { id: 'asc' },
    });
    if (!cancelled) {
      throw new BadRequestException('Cancelled status not configured');
    }
    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        status: 'Cancelled',
        timestamp: new Date().toISOString(),
        note: 'Cancelled by customer',
      },
    ];
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { statusId: cancelled.id, timeline: timeline as any },
      include: { status: true },
    });

    this.events.emit({
      type: 'order.status_changed',
      data: {
        id: updated.id,
        displayId: updated.displayId,
        statusId: cancelled.id,
        statusName: cancelled.name,
      },
    });

    try {
      await this.inventoryService.restockOrderItems(
        orderId,
        'customer',
        'cancellation_restock',
      );
    } catch (err) {
      this.logger.error(`Failed to restock cancelled order ${orderId}:`, err);
    }

    return updated;
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

  private async firePurchaseIfModeMatches(
    statusName: string,
    order: any,
    _userId: string,
  ) {
    try {
      const settings = await this.prisma.systemSetting.findMany({
        where: {
          key: { in: ['tracking_meta_purchase_mode', 'tracking_meta_validated_status', 'tracking_tiktok_purchase_mode', 'tracking_tiktok_validated_status'] },
        },
      });
      const settingMap = Object.fromEntries(
        settings.map((s: any) => [s.key, s.value]),
      );
      const metaMode = settingMap['tracking_meta_purchase_mode'] || 'instant';
      const metaStatus = settingMap['tracking_meta_validated_status'] || '';
      const tiktokMode = settingMap['tracking_tiktok_purchase_mode'] || 'instant';
      const tiktokStatus = settingMap['tracking_tiktok_validated_status'] || '';

      const shouldFire =
        (metaMode === 'validated' && metaStatus === statusName) ||
        (tiktokMode === 'validated' && tiktokStatus === statusName);

      if (!shouldFire) return;

      let email = '';
      let phone = '';
      let firstName = '';
      let lastName = '';
      let city = '';
      let country = 'BD';

      if (order.customer) {
        email = order.customer.email || '';
        firstName = order.customer.firstName || '';
        lastName = order.customer.lastName || '';
        phone = order.customer.phoneNumber || '';
      }

      if (!phone) phone = order.guestPhone || '';
      if (!firstName) firstName = order.guestName || '';

      const shippingAddr = order.shippingAddress || {};
      if (typeof shippingAddr === 'object') {
        city = shippingAddr.city || shippingAddr.district || '';
        if (shippingAddr.country) country = shippingAddr.country;
      }

      const savedCtx = await this.tracking.getContext(order.id);
      const itemsList = (order.items as any[]) || [];
      const totalValue = Number(order.total || 0);

      const customData = {
        value: totalValue,
        currency: 'BDT',
        content_ids: itemsList.map((i: any) => i.productId || i.comboId || '').filter(Boolean),
        num_items: itemsList.reduce((s: number, i: any) => s + (i.quantity || 0), 0),
        order_id: order.id,
        contents: itemsList.map((i: any) => ({
          id: i.productId || i.comboId || '',
          quantity: i.quantity,
          item_price: Number(i.price),
        })),
      };

      await this.tracking.track({
        eventName: 'purchase',
        eventId: `purchase_${order.id}`,
        userId: order.customerId || undefined,
        userData: {
          email,
          phone,
          name: firstName || undefined,
          city,
          country,
          ip: '',
          userAgent: '',
          fbp: savedCtx?.fbp || undefined,
          fbc: savedCtx?.fbc || undefined,
          url: savedCtx?.url || undefined,
          referrer: savedCtx?.referrer || undefined,
        },
        customData,
      });
    } catch (err) {
      this.logger.error('Failed to fire purchase event:', err);
    }
  }

  private async deductStock(
    tx: Prisma.TransactionClient,
    items: {
      productId?: string;
      variantId?: string;
      comboId?: string;
      comboSelection?: Record<string, string>;
      quantity: number;
    }[],
    displayId: string,
    isRestock = false,
  ) {
    const standaloneProductIds = items
      .filter((i) => i.productId && !i.comboId)
      .map((i) => i.productId!);
    const standaloneVariantIds = items
      .filter((i) => i.variantId && !i.comboId)
      .map((i) => i.variantId!);

    const comboIds = items.filter((i) => i.comboId).map((i) => i.comboId!);
    const combos = comboIds.length > 0 ? await tx.combo.findMany({
      where: { id: { in: comboIds } },
      include: { items: true },
    }) : [];
    const comboMap = new Map(combos.map((c) => [c.id, c]));

    const productIdsToLock = new Set<string>(standaloneProductIds);
    const variantIdsToLock = new Set<string>(standaloneVariantIds);

    for (const item of items) {
      if (item.comboId) {
        const combo = comboMap.get(item.comboId);
        if (!combo) {
          throw new BadRequestException(`Combo not found during stock deduction`);
        }
        for (const ci of combo.items) {
          productIdsToLock.add(ci.productId);
          const effectiveVariantId =
            ci.variantId ||
            item.comboSelection?.[ci.productId] ||
            null;
          if (effectiveVariantId) {
            variantIdsToLock.add(effectiveVariantId);
          }
        }
      }
    }

    const sortedProductIds = Array.from(productIdsToLock).sort();
    const sortedVariantIds = Array.from(variantIdsToLock).sort();

    // Perform SELECT FOR UPDATE on PostgreSQL
    if (sortedProductIds.length > 0) {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "Product" WHERE id IN (${sortedProductIds.map((_, i) => `$${i + 1}`).join(', ')}) FOR UPDATE`,
        ...sortedProductIds
      );
    }
    if (sortedVariantIds.length > 0) {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "ProductVariant" WHERE id IN (${sortedVariantIds.map((_, i) => `$${i + 1}`).join(', ')}) FOR UPDATE`,
        ...sortedVariantIds
      );
    }

    const products =
      sortedProductIds.length > 0
        ? await tx.product.findMany({
            where: { id: { in: sortedProductIds }, manageStock: true },
            select: { id: true, type: true, stock: true, manageStock: true },
          })
        : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const variants =
      sortedVariantIds.length > 0
        ? await tx.productVariant.findMany({
            where: {
              id: { in: sortedVariantIds },
              product: { manageStock: true },
            },
            select: { id: true, stock: true, productId: true },
          })
        : [];
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    for (const item of items) {
      if (item.comboId) {
        const combo = comboMap.get(item.comboId);
        if (!combo) continue;
        for (const ci of combo.items) {
          const qty = ci.quantity * item.quantity;
          const effectiveVariantId =
            ci.variantId ||
            item.comboSelection?.[ci.productId] ||
            null;

          if (effectiveVariantId) {
            const v = variantMap.get(effectiveVariantId);
            if (v && v.stock < qty) {
              throw new BadRequestException(
                `Insufficient stock for variant of product "${ci.productId}". Available: ${v.stock}, requested: ${qty}.`,
              );
            }
            if (v) {
              await tx.productVariant.update({
                where: { id: effectiveVariantId },
                data: { stock: isRestock ? { increment: qty } : { decrement: qty } },
              });
              v.stock += isRestock ? qty : -qty;
            }
          }

          const p = productMap.get(ci.productId);
          if (p && p.manageStock && p.stock < qty) {
            throw new BadRequestException(
              `Insufficient stock for product "${ci.productId}". Available: ${p.stock}, requested: ${qty}.`,
            );
          }
          if (p && p.manageStock) {
            await tx.product.update({
              where: { id: ci.productId },
              data: { stock: isRestock ? { increment: qty } : { decrement: qty } },
            });
            p.stock += isRestock ? qty : -qty;
          }
          await tx.inventoryLog.create({
            data: {
              productId: ci.productId,
              variantId: effectiveVariantId,
              comboId: item.comboId,
              quantity: isRestock ? qty : -qty,
              type: isRestock ? 'restock' : 'combo_order',
              reason: isRestock ? `Restock from Order ${displayId}` : `Combo in Order ${displayId}`,
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
        if (item.variantId && variant) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: isRestock ? { increment: item.quantity } : { decrement: item.quantity } },
          });
          variant.stock += isRestock ? item.quantity : -item.quantity;
        }

        const product = item.productId ? productMap.get(item.productId) : null;
        if (
          product &&
          product.manageStock &&
          (!item.variantId || product.type === 'simple') &&
          product.stock < item.quantity
        ) {
          throw new BadRequestException(
            `Insufficient stock for product "${item.productId}". Available: ${product.stock}, requested: ${item.quantity}.`,
          );
        }
        if (
          product &&
          product.manageStock &&
          (!item.variantId || product.type === 'simple')
        ) {
          await tx.product.update({
            where: { id: item.productId! },
            data: { stock: isRestock ? { increment: item.quantity } : { decrement: item.quantity } },
          });
          product.stock += isRestock ? item.quantity : -item.quantity;
        }

        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            quantity: isRestock ? item.quantity : -item.quantity,
            type: isRestock ? 'restock' : 'order_placed',
            reason: isRestock ? `Restock from Order ${displayId}` : `Order ${displayId}`,
            createdAt: new Date(),
          },
        });
      }
    }
  }
}
