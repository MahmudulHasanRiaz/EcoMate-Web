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
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { CostingLotService } from '../stock/costing-lot.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { CouponsService } from '../coupons/coupons.service';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
  CustomerInfoDto,
} from './dto/order.dto';
import {
  PaymentStatus,
  PaymentOptionType,
  Prisma,
  ManagedStockMovementType,
  MovementDirection,
  ReferenceEntity,
} from '@prisma/client';
import { ManagedStockLedgerService } from '../inventory/managed-stock-ledger.service';
import { buildTrackingUrl } from '../courier-manager/courier-webhook.service';
import { normalizePhone } from '../common/utils/phone-utils';
import { BlockedEntriesService } from '../blocked-entries/blocked-entries.service';
import { SecurityService } from '../security/security.service';

const ORDER_TRANSITIONS: Record<string, string[]> = {
  Pending: ['Payment Pending', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Pending': ['Payment Verifying', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Verifying': ['Confirmed', 'Hold', 'Cancelled'],
  Hold: ['Pending', 'Confirmed', 'Cancelled'],
  Confirmed: ['Packed', 'Packing Hold', 'Cancelled'],
  Packed: ['Shipping', 'Packing Hold'],
  'Packing Hold': ['Packed', 'Cancelled'],
  Shipping: ['Delivered', 'Partial'],
  Delivered: ['Return Pending'],
  Partial: ['Return Pending'],
  'Return Pending': ['Returned', 'Damaged'],
  Returned: ['Damaged'],
  Cancelled: ['Confirmed'],
  Damaged: [],
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
    private readonly customersService: CustomersService,
    private readonly events: OrdersEventService,
    private readonly stockService: StockService,
    private readonly stockRouter: StockRouterService,
    private readonly blockedEntries: BlockedEntriesService,
    private readonly security: SecurityService,
    private readonly couponsService: CouponsService,
    private readonly managedStockLedger: ManagedStockLedgerService,
    private readonly costingLotService: CostingLotService,
    private readonly cancelReturnStock: CancelReturnStockService,
  ) {}

  private async resolveAndApplyStock(
    opType: 'reserve' | 'release' | 'deduct' | 'add',
    productId: string | null | undefined,
    variantId: string | null | undefined,
    quantity: number,
    reference: string,
    tx: Prisma.TransactionClient,
    options?: {
      comboId?: string;
      comboSelection?: any;
      warehouseId?: string;
      orderId?: string;
      orderItemId?: string;
      performedBy?: string;
      ledgerType?: string;
    },
  ) {
    if (!productId) return;
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { availabilityMode: true, warehouseId: true, syncManagedStock: true },
    });
    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
    const decision = this.stockRouter.resolve(product?.availabilityMode, opType, imEnabled, product?.syncManagedStock ?? undefined);
    let wh = options?.warehouseId || product?.warehouseId;
    if (!wh && decision.pi !== 'skip') {
      const firstStock = await tx.physicalInventory.findFirst({
        where: {
          productId,
          variantId: variantId || null,
        },
        select: { warehouseId: true },
      });
      if (firstStock) wh = firstStock.warehouseId;
    }

    if (decision.ms !== 'skip') {
      const shouldApplyMs = !decision.msConditionalOnSync || product?.syncManagedStock;
      if (shouldApplyMs) {
        await this.stockService.operate(decision.ms as any, {
          productId,
          variantId: variantId || undefined,
          comboId: options?.comboId,
          comboSelection: options?.comboSelection,
          quantity,
          reference,
          performedBy: options?.performedBy,
          tx,
          ledgerType: options?.ledgerType,
        });

        if (options?.orderItemId) {
          if (decision.ms === 'reserve') {
            await tx.orderItem.update({
              where: { id: options.orderItemId },
              data: { managedStockReserved: true },
            });
          } else if (decision.ms === 'release' || decision.ms === 'deduct') {
            await tx.orderItem.update({
              where: { id: options.orderItemId },
              data: { managedStockReserved: false },
            });
          } else if (decision.ms === 'add') {
            await tx.orderItem.update({
              where: { id: options.orderItemId },
              data: { managedStockReserved: false, managedStockDeducted: false },
            });
          }
        }
      }
    }

    if (decision.pi === 'add' && wh) {
      await this.stockService.addPhysical({
        productId,
        variantId: variantId || undefined,
        comboId: options?.comboId,
        comboSelection: options?.comboSelection,
        quantity,
        reference,
        performedBy: options?.performedBy,
        warehouseId: wh,
        tx,
        ledgerType: options?.ledgerType,
      });
    }
  }

  private parseTimeline(timeline: unknown): any[] {
    return Array.isArray(timeline) ? timeline : [];
  }

  private transformOrder(order: any) {
    if (!order) return order;
    const sa = order.shippingAddress;
    const normalizedAddress =
      sa && typeof sa === 'object'
        ? {
            ...sa,
            address: sa.address || sa.addressLine || '',
            city: sa.city || sa.thana || '',
            zone: sa.zone || sa.district || '',
          }
        : sa;
    return {
      ...order,
      customer: order.customer
        ? {
            ...order.customer,
            firstName: order.customer.name || '',
            lastName: '',
            phoneNumber: order.customer.phone || '',
          }
        : order.customer,
      shippingAddress: normalizedAddress,
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
    paymentStatus?: string;
    courier?: string;
    assignedToId?: string;
    dateFrom?: string;
    dateTo?: string;
    sort?: string;
    order?: string;
    includeTrashed?: boolean;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: any = {};
    if (!query.includeTrashed) where.trashedAt = null;
    if (query.search) {
      const normalizedPhone = normalizePhone(query.search);
      where.OR = [
        { displayId: { contains: query.search, mode: 'insensitive' } },
        {
          customer: {
            name: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          customer: {
            phone: { contains: normalizedPhone || query.search },
          },
        },
        { guestName: { contains: query.search, mode: 'insensitive' } },
        { guestPhone: { contains: normalizedPhone || query.search } },
      ];
    }
    if (query.statusId) where.statusId = query.statusId;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
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
              name: true,
              email: true,
              phone: true,
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

    const statusCounts = stats.reduce(
      (acc, curr) => {
        acc[curr.statusId] = curr._count;
        return acc;
      },
      {} as Record<string, number>,
    );

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

  async findMyOrders(
    userId: string,
    query: { page?: number; perPage?: number; status?: string },
  ) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: any = { customerId: userId, trashedAt: null };
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
              product: {
                select: { id: true, name: true, images: true, slug: true },
              },
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
        dispatches: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');
    return this.transformOrder(order);
  }

  async findOne(id: string, opts: { token?: string; userId?: string } = {}) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
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
            variant: {
              include: {
                attributeValues: {
                  include: {
                    attributeValue: true,
                  },
                },
              },
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
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');
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
      const orderBlockIp =
        await this.blockedEntries.findOrderBlockedIp(clientIp);
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
        clientIp,
      );
      dto.customerId = customer.id;
    }

    if (dto.customerId) {
      const user = await this.prisma.userProfile.findUnique({
        where: { id: dto.customerId },
        select: { status: true, phoneNumber: true, firstName: true, lastName: true },
      });
      if (user?.status === 'suspended') {
        throw new BadRequestException(
          'This account has been blocked. Please contact support.',
        );
      }
      // Ensure CustomerProfile exists (order FK now references CustomerProfile)
      const phone = dto.guestPhone || user?.phoneNumber;
      const name = dto.guestName || (user ? `${user.firstName} ${user.lastName}`.trim() : 'Customer');
      if (phone) {
        await this.prisma.customerProfile.upsert({
          where: { id: dto.customerId },
          create: { id: dto.customerId, phone, name },
          update: { phone, name },
        });
      }
    }

    // ALWAYS_OUT_OF_STOCK guard: block order creation for these products
    const itemProductIds = dto.items.filter(i => i.productId).map(i => i.productId!);
    if (itemProductIds.length > 0) {
      const blockedProducts = await this.prisma.product.findMany({
        where: {
          id: { in: itemProductIds },
          availabilityMode: 'ALWAYS_OUT_OF_STOCK',
        },
        select: { id: true, name: true },
      });
      if (blockedProducts.length > 0) {
        const names = blockedProducts.map(p => p.name).join(', ');
        throw new BadRequestException(
          `Cannot order "${names}" — this product is currently unavailable.`,
        );
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      // Fetch and validate database prices and active statuses
      const productIds = Array.from(
        new Set(dto.items.filter((i) => i.productId).map((i) => i.productId!)),
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
                availabilityMode: true,
                name: true,
              },
            })
          : [];
      const productMap = new Map(products.map((p) => [p.id, p]));

      const variantIds = Array.from(
        new Set(dto.items.filter((i) => i.variantId).map((i) => i.variantId!)),
      );
      const variants =
        variantIds.length > 0
          ? await tx.productVariant.findMany({
              where: { id: { in: variantIds } },
              select: {
                id: true,
                price: true,
                salePrice: true,
                isActive: true,
                productId: true,
              },
            })
          : [];
      const variantMap = new Map(variants.map((v) => [v.id, v]));

      const comboIds = Array.from(
        new Set(dto.items.filter((i) => i.comboId).map((i) => i.comboId!)),
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
                items: {
                  select: {
                    productId: true,
                    variantId: true,
                    product: { select: { type: true } },
                  },
                },
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

          for (const sub of combo.items) {
            if (
              sub.product?.type === 'variable' &&
              !sub.variantId &&
              (!item.comboSelection || !item.comboSelection[sub.productId])
            ) {
              throw new BadRequestException(
                `Product "${sub.productId}" in combo "${combo.name}" requires a variant selection.`,
              );
            }
          }
        } else if (item.variantId) {
          const variant = variantMap.get(item.variantId);
          if (!variant) {
            throw new BadRequestException(
              `Variant ${item.variantId} not found`,
            );
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
          if (parentProduct.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
            throw new BadRequestException(
              `Product "${parentProduct.name}" is out of stock and cannot be ordered`,
            );
          }
          item.price = Number(
            variant.salePrice ??
              variant.price ??
              parentProduct.salePrice ??
              parentProduct.basePrice ??
              0,
          );
        } else if (item.productId) {
          const product = productMap.get(item.productId);
          if (!product) {
            throw new BadRequestException(
              `Product ${item.productId} not found`,
            );
          }
          if (!product.isActive) {
            throw new BadRequestException(`Product is no longer active`);
          }
          if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
            throw new BadRequestException(
              `Product "${product.name}" is out of stock and cannot be ordered`,
            );
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

      if (dto.couponCode) {
        const coupons = await tx.$queryRawUnsafe<any[]>(
          'SELECT "minOrderValue" FROM "Coupon" WHERE code = $1 FOR UPDATE',
          dto.couponCode,
        );
        const coupon = coupons[0];
        if (
          coupon?.minOrderValue &&
          Number(subtotal) < Number(coupon.minOrderValue)
        ) {
          throw new BadRequestException(
            `Minimum order value of ${coupon.minOrderValue} required for this coupon`,
          );
        }
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
          salesChannel: dto.salesChannel || 'WEBSITE',
          guestName: dto.guestName,
          guestPhone: dto.guestPhone,
          paymentOptionType: dto.paymentOptionType,
          paymentStatus:
            dto.paymentOptionType === 'CASH_ON_DELIVERY'
              ? PaymentStatus.UNPAID
              : PaymentStatus.PAYMENT_PENDING,
          partialAmount:
            dto.paymentOptionType === 'PARTIAL_PAYMENT'
              ? (dto.partialAmount ?? undefined)
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
              name: true,
              email: true,
              phone: true,
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

      const phoneToClose = dto.guestPhone || created.customer?.phone;
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

      for (const item of dto.items) {
        const createdItem = created.items.find((ci) => {
          if (item.comboId) {
            return ci.comboId === item.comboId;
          }
          return ci.productId === item.productId && (ci.variantId ?? undefined) === (item.variantId ?? undefined);
        });

        if (item.comboId && createdItem) {
          const combo = await tx.combo.findUnique({
            where: { id: item.comboId },
            include: { items: true },
          });
          if (combo) {
            for (const ci of combo.items) {
              const resolvedVariantId = ci.variantId || (item.comboSelection as Record<string, string> | null)?.[ci.productId] || null;
              const unitQty = ci.quantity;
              const totalQty = unitQty * item.quantity;

              const snapshot = await tx.orderItemComboComponent.create({
                data: {
                  orderItemId: createdItem.id,
                  comboItemId: ci.id,
                  productId: ci.productId,
                  variantId: resolvedVariantId,
                  unitQuantity: unitQty,
                  totalQuantity: totalQty,
                  managedStockReserved: false,
                  managedStockDeducted: false,
                },
                include: { product: true }
              });

              if (snapshot.product.availabilityMode === 'MANAGED_STOCK' && snapshot.product.manageStock) {
                await this.stockService.operate('reserve', {
                  productId: snapshot.productId,
                  variantId: snapshot.variantId ?? undefined,
                  quantity: snapshot.totalQuantity,
                  reference: `Order create: ${displayId}`,
                  performedBy: 'system',
                  tx,
                });
                await tx.orderItemComboComponent.update({
                  where: { id: snapshot.id },
                  data: { managedStockReserved: true },
                });
              }
            }
          }
        } else if (createdItem) {
          await this.resolveAndApplyStock(
            'reserve',
            item.productId,
            item.variantId,
            item.quantity,
            displayId,
            tx,
            {
              orderId: created.id,
              orderItemId: createdItem.id,
            },
          );
        }
      }

      return created;
    });

    this.security.recordOrder(dto.guestPhone || '', clientIp || '');

    if (dto.couponCode) {
      await this.couponsService.apply(
        dto.couponCode,
        order.id,
        undefined,
        dto.discount || 0,
      );
    }

    this.events.emit({
      type: 'order.created',
      data: { id: order.id, displayId: order.displayId },
    });

    // Fire server-side Purchase for "instant" mode — queue for reliability
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
        this.firePurchaseInstant(orderWithItems as any).catch((err) => {
          this.logger.error('Failed to fire instant purchase event:', err);
        });
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
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');

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

    const discountChanged =
      dto.discount !== undefined &&
      Number(dto.discount) !== Number(order.discount);
    const discountTypeChanged =
      dto.discountType !== undefined && dto.discountType !== order.discountType;
    if (discountChanged || discountTypeChanged) {
      const logNewVal = dto.discount !== undefined ? Number(dto.discount) : Number(order.discount);
      const logType = dto.discountType || order.discountType;
      timeline.push({
        type: 'discount',
        visibility: 'public',
        timestamp: now,
        oldValue: Number(order.discount),
        newValue: logNewVal,
        discountType: logType,
        note: `Discount changed to ৳${logNewVal} (${logType})`,
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
      dto.shippingCharge !== undefined
        ? Number(dto.shippingCharge)
        : Number(order.shippingCharge);
    const discount =
      dto.discount !== undefined
        ? Number(dto.discount)
        : Number(order.discount);
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
        // Release old items via router
        for (const item of order.items) {
          if (item.comboId) {
            // Release managed stock from each combo component snapshot
            const snapshots = await tx.orderItemComboComponent.findMany({
              where: { orderItemId: item.id },
              include: { product: true },
            });
            for (const snap of snapshots) {
              if (snap.managedStockReserved && !snap.managedStockDeducted) {
                await this.stockService.operate('release', {
                  productId: snap.productId,
                  variantId: snap.variantId ?? undefined,
                  quantity: snap.totalQuantity,
                  reference: `Order update release: ${order.displayId}`,
                  performedBy: 'system',
                  tx,
                });
              }
              // Physical reservation release (if any ACTIVE cycle reservation)
              // Cascade will delete ComboComponentPhysicalReservation when item is deleted,
              // but we must release the physicalInventory.reservedQuantity first
              const activePhysRes = await tx.comboComponentPhysicalReservation.findFirst({
                where: { componentId: snap.id, status: 'ACTIVE' },
                include: { allocations: true },
              });
              if (activePhysRes) {
                for (const alloc of activePhysRes.allocations) {
                  await tx.physicalInventory.update({
                    where: { id: alloc.physicalInventoryId },
                    data: { reservedQuantity: { decrement: alloc.quantity } },
                  });
                }
                await tx.comboComponentPhysicalReservation.update({
                  where: { id: activePhysRes.id },
                  data: { status: 'RELEASED' },
                });
              }
            }
          } else {
            await this.resolveAndApplyStock(
              'release',
              item.productId,
              item.variantId,
              item.quantity,
              order.displayId,
              tx,
              {
                orderId: id,
                orderItemId: item.id,
              },
            );
          }
        }

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

        const newItems = await tx.orderItem.findMany({
          where: { orderId: id },
        });

        // Reserve stock for new items
        const newProductIds = Array.from(
          new Set(
            dto.items.filter((i) => i.productId).map((i) => i.productId!),
          ),
        );
        if (newProductIds.length > 0) {
          const newProducts = await tx.product.findMany({
            where: { id: { in: newProductIds } },
            select: { id: true, availabilityMode: true, name: true },
          });
          const outOfStock = newProducts.find(
            (p) => p.availabilityMode === 'ALWAYS_OUT_OF_STOCK',
          );
          if (outOfStock) {
            throw new BadRequestException(
              `Product "${outOfStock.name}" is out of stock and cannot be ordered`,
            );
          }
        }

        // Reserve stock for new items via router
        for (const item of dto.items) {
          const newItem = newItems.find((ni) => {
            if (item.comboId) return ni.comboId === item.comboId;
            return ni.productId === item.productId && (ni.variantId ?? undefined) === item.variantId;
          });

          if (item.comboId && newItem) {
            const combo = await tx.combo.findUnique({
              where: { id: item.comboId },
              include: { items: true },
            });
            if (combo) {
              for (const ci of combo.items) {
                const resolvedVariantId = ci.variantId || (item.comboSelection as Record<string, string> | null)?.[ci.productId] || null;
                const unitQty = ci.quantity;
                const totalQty = unitQty * item.quantity;

                const snapshot = await tx.orderItemComboComponent.create({
                  data: {
                    orderItemId: newItem.id,
                    comboItemId: ci.id,
                    productId: ci.productId,
                    variantId: resolvedVariantId,
                    unitQuantity: unitQty,
                    totalQuantity: totalQty,
                    managedStockReserved: false,
                    managedStockDeducted: false,
                  },
                  include: { product: true },
                });

                if (snapshot.product.availabilityMode === 'MANAGED_STOCK' && snapshot.product.manageStock) {
                  await this.stockService.operate('reserve', {
                    productId: snapshot.productId,
                    variantId: snapshot.variantId ?? undefined,
                    quantity: snapshot.totalQuantity,
                    reference: `Order update reserve: ${order.displayId}`,
                    performedBy: 'system',
                    tx,
                  });
                  await tx.orderItemComboComponent.update({
                    where: { id: snapshot.id },
                    data: { managedStockReserved: true },
                  });
                }
              }
            }
          } else if (newItem) {
            await this.resolveAndApplyStock(
              'reserve',
              item.productId,
              item.variantId,
              item.quantity,
              order.displayId,
              tx,
              {
                orderId: id,
                orderItemId: newItem.id,
              },
            );
          }
        }
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
          if (!normalized)
            throw new BadRequestException('Invalid phone number');
          safeData.phoneNumber = normalized;
        }
        if (Object.keys(safeData).length > 0) {
          await tx.userProfile.update({
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
              name: true,
              email: true,
              phone: true,
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
          dispatches: { orderBy: { createdAt: 'desc' } },
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
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');

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
        customer: { select: { id: true, name: true } },
      },
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateOrderStatusDto,
    userId: string,
    performedBy?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { status: true },
    });
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');

    const newStatus = await this.prisma.orderStatus.findUnique({
      where: { id: dto.statusId },
    });
    if (!newStatus) throw new NotFoundException('Status not found');

    const allowed = ORDER_TRANSITIONS[order.status.name] || [];
    if (!allowed.includes(newStatus.name)) {
      throw new BadRequestException(
        `Cannot transition from "${order.status.name}" to "${newStatus.name}". Allowed: ${allowed.join(', ') || 'none'}`,
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.order.update({
        where: { id },
        data: { statusId: dto.statusId, timeline: timeline as any },
        include: {
          status: true,
          customer: { select: { id: true, name: true } },
          payments: true,
        },
      });

      if (newStatus.name === 'Confirmed') {
        await this.takeCostSnapshot(id, tx);
        await this.verifyStockForOrder(id, tx);
      }

      if (newStatus.name === 'Cancelled') {
        await this.handleCancelledSideEffects(tx, id, performedBy);
      }

      if (newStatus.name === 'Delivered') {
        const codPayment = u.payments?.find(
          (p) => p.gatewayCode === 'cash' && p.status === PaymentStatus.UNPAID,
        );
        if (codPayment) {
          await tx.payment.update({
            where: { id: codPayment.id },
            data: {
              status: PaymentStatus.PAID,
              verifiedBy: userId,
              verifiedAt: new Date(),
            },
          });
        }
      }

      if (newStatus.name === 'Returned') {
        await this.handleReturnedSideEffects(tx, id, performedBy);
      }

      return u;
    });

    this.events.emit({
      type: 'order.status_changed',
      data: {
        id: updated.id,
        displayId: updated.displayId,
        statusId: dto.statusId,
        statusName: newStatus.name,
      },
    });

    // Re-fetch with full relations for tracking payload
    const updatedWithItems = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: { product: { select: { id: true, name: true } } },
        },
        customer: true,
        payments: true,
      },
    });
    if (updatedWithItems) {
      await this.firePurchaseValidated(
        newStatus.name,
        updatedWithItems as any,
      ).catch((err) => {
        this.logger.error('Failed to fire validated purchase event:', err);
      });

      // Fire refund for cancelled/returned orders
      if (
        ['Cancelled', 'Returned', 'Return Pending'].includes(newStatus.name)
      ) {
        this.fireRefundEvent(updatedWithItems as any).catch((err) => {
          this.logger.error('Failed to fire refund event:', err);
        });
      }
    }

    return updated;
  }

  async submitPaymentProof(
    orderId: string,
    proofData: { transactionId?: string; screenshot?: string },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');
    if (
      order.status?.name !== 'Payment Pending' &&
      order.status?.name !== 'Payment Verifying'
    ) {
      throw new BadRequestException(
        'Order is not in Payment Pending or Payment Verifying status',
      );
    }

    const paymentVerifyingStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Payment Verifying' },
    });

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        statusId: paymentVerifyingStatus!.id,
        paymentStatus: 'PAYMENT_VERIFYING',
        paymentProof: proofData,
      },
      include: {
        status: true,
        payments: true,
      },
    });
  }

  async verifyPayment(orderId: string, verified: boolean, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { status: true },
      });
      if (!order || order.trashedAt) throw new NotFoundException('Order not found');
      if (order.paymentStatus !== 'PAYMENT_VERIFYING') {
        throw new BadRequestException(
          'Order is not awaiting payment verification',
        );
      }

      const targetStatusName = verified ? 'Confirmed' : 'Payment Pending';
      const targetStatus = await tx.orderStatus.findUnique({
        where: { name: targetStatusName },
      });

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: verified ? 'PAID' : 'PAYMENT_PENDING',
          statusId: targetStatus!.id,
          ...(note ? { internalNote: note } : {}),
        },
        include: {
          status: true,
          payments: true,
        },
      });

      if (verified) {
        await this.handleConfirmedSideEffects(tx, orderId);
      }

      return updated;
    });
  }

  async addItem(orderId: string, dto: UpdateOrderItemDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');

    if (dto.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { availabilityMode: true, name: true },
      });
      if (product?.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
        throw new BadRequestException(
          `Product "${product.name}" is out of stock and cannot be ordered`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const orderItem = await tx.orderItem.create({
        data: {
          orderId,
          productId: dto.productId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          price: dto.price,
        },
      });

      await this.resolveAndApplyStock(
        'reserve',
        dto.productId,
        dto.variantId,
        dto.quantity,
        order.displayId,
        tx,
        {
          orderId,
          orderItemId: orderItem.id,
        },
      );

      this.events.emit({
        type: 'order.status_changed',
        data: { id: orderId, displayId: order.displayId, note: 'Item added' },
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

      return tx.order.update({
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
    });
  }

  async removeItem(orderId: string, itemId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');

    const removedItem = order.items.find((i) => i.id === itemId);
    if (!removedItem) throw new NotFoundException('Order item not found');

    return this.prisma.$transaction(async (tx) => {
      await this.resolveAndApplyStock(
        'release',
        removedItem.productId,
        removedItem.variantId,
        removedItem.quantity,
        order.displayId,
        tx,
        {
          comboId: removedItem.comboId || undefined,
          comboSelection: (removedItem.comboSelection as Record<string, string>) || undefined,
          orderId,
          orderItemId: removedItem.id,
        },
      );

      await tx.orderItem.delete({ where: { id: itemId } });

      const remaining = order.items
        .filter((i) => i.id !== itemId)
        .map((i) => ({ price: Number(i.price), quantity: i.quantity }));
      const { subtotal, total } = this.recalculate(
        remaining,
        Number(order.shippingCharge),
        Number(order.discount),
        order.discountType || 'flat',
      );

      return tx.order.update({
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
            name: true,
            email: true,
            phone: true,
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
        displayId: true,
        timeline: true,
        statusId: true,
        status: { select: { name: true } },
      },
    });

    const validIds: string[] = [];
    const skipped: string[] = [];
    const failedDetails: { id: string; reason: string }[] = [];
    for (const order of orders) {
      const allowed = ORDER_TRANSITIONS[order.status.name] || [];
      if (allowed.includes(targetStatus.name)) {
        validIds.push(order.id);
      } else {
        skipped.push(order.id);
      }
    }

    if (validIds.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.order.updateMany({
          where: { id: { in: validIds } },
          data: { statusId },
        });

        if (targetStatus.name === 'Cancelled') {
          for (const cancelOrderId of validIds) {
            await this.handleCancelledSideEffects(tx, cancelOrderId, userId);
          }
        }

        if (targetStatus.name === 'Confirmed') {
          for (const confirmOrderId of validIds) {
            await this.handleConfirmedSideEffects(tx, confirmOrderId, userId);
          }
        }

        for (const order of orders) {
          if (!validIds.includes(order.id)) continue;
          const tl = [
            ...this.parseTimeline(order.timeline),
            {
              status: targetStatus.name,
              timestamp: new Date().toISOString(),
              note: `Bulk status changed to ${targetStatus.name}`,
              performedBy: userId,
            },
          ];
          await tx.order.update({
            where: { id: order.id },
            data: { timeline: tl as any },
          });
        }
      });
    }

    return {
      updated: validIds.length,
      skipped: skipped.length,
      failed: failedDetails.length,
      failedDetails,
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
    return this.prisma.userProfile.findMany({
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
        trashedAt: null,
        OR: [
          { viewToken: queryStr },
          { displayId: { equals: queryStr, mode: 'insensitive' } },
        ],
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
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
      throw new BadRequestException(
        'Invalid Bangladeshi phone number format. Use 01XXXXXXXXX or +8801XXXXXXXXX.',
      );
    }

    const orders = await this.prisma.order.findMany({
      where: {
        trashedAt: null,
        OR: [{ guestPhone: normalized }, { customer: { phone: normalized } }],
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
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
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');
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
    if (!order || order.trashedAt || order.viewToken !== token) {
      throw new NotFoundException('Order not found');
    }
    const cancelled = await this.prisma.orderStatus.findFirst({
      where: { name: 'Cancelled' },
    });
    if (!cancelled) {
      throw new BadRequestException('Cancelled status not configured');
    }
    const allowed = ORDER_TRANSITIONS[order.status.name] || [];
    if (!allowed.includes('Cancelled')) {
      throw new BadRequestException(
        `Order in "${order.status.name}" status cannot be cancelled`,
      );
    }
    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        status: cancelled.name,
        timestamp: new Date().toISOString(),
        note: 'Cancelled by customer',
      },
    ];
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.order.update({
        where: { id: orderId },
        data: { statusId: cancelled.id, timeline: timeline as any },
        include: { status: true },
      });

      await this.handleCancelledSideEffects(tx, orderId, 'customer');

      return u;
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

    // Fire refund for customer-cancelled orders
    this.prisma.order
      .findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: { select: { id: true, name: true } } } },
          customer: true,
        },
      })
      .then((refundOrder) => {
        if (refundOrder) {
          this.fireRefundEvent(refundOrder as any).catch((err) => {
            this.logger.error(
              'Failed to fire refund for customer cancel:',
              err,
            );
          });
        }
      });

    return updated;
  }

  async trash(orderId: string, performedBy?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.trashedAt) throw new BadRequestException('Order is already trashed');

    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        type: 'trash',
        status: order.status.name,
        timestamp: new Date().toISOString(),
        note: 'Order moved to trash',
        performedBy: performedBy || 'system',
      },
    ];

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          trashedAt: new Date(),
          timeline: timeline as any,
        },
      });

      await this.handleCancelledSideEffects(tx, orderId, performedBy);
    });

    this.events.emit({
      type: 'order.trashed',
      data: { id: order.id, displayId: order.displayId },
    });

    return { success: true, message: 'Order moved to trash' };
  }

  async restore(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.trashedAt) throw new BadRequestException('Order is not trashed');

    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        type: 'restore',
        timestamp: new Date().toISOString(),
        note: 'Order restored from trash',
      },
    ];

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        trashedAt: null,
        timeline: timeline as any,
      },
    });

    this.events.emit({
      type: 'order.restored',
      data: { id: order.id, displayId: order.displayId },
    });

    return { success: true, message: 'Order restored from trash' };
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

  async transitionOrderStatus(
    orderId: string,
    newStatus: string,
    performedBy?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          status: true,
          items: { include: { product: true, variant: true } },
        },
      });
      if (!order || order.trashedAt) throw new NotFoundException(`Order ${orderId} not found`);

      const currentStatus = order.status.name;
      const allowed = ORDER_TRANSITIONS[currentStatus];
      if (!allowed || !allowed.includes(newStatus)) {
        throw new BadRequestException(
          `Cannot transition from "${currentStatus}" to "${newStatus}". Allowed: ${allowed?.join(', ') || 'none'}`,
        );
      }

      const targetStatus = await tx.orderStatus.findUnique({
        where: { name: newStatus },
      });
      if (!targetStatus)
        throw new NotFoundException(`Status "${newStatus}" not found`);

      await tx.order.update({
        where: { id: orderId },
        data: { statusId: targetStatus.id },
      });

      await this.executeTransitionSideEffects(
        tx,
        order,
        currentStatus,
        newStatus,
        performedBy,
      );

      return { success: true, from: currentStatus, to: newStatus };
    });
  }

  private async executeTransitionSideEffects(
    tx: Prisma.TransactionClient,
    order: any,
    fromStatus: string,
    toStatus: string,
    performedBy?: string,
  ) {
    switch (toStatus) {
      case 'Confirmed':
        await this.handleConfirmedSideEffects(tx, order.id, performedBy);
        break;
      case 'Cancelled':
        await this.handleCancelledSideEffects(tx, order.id, performedBy);
        break;
      case 'Returned':
        await this.handleReturnedSideEffects(tx, order.id, performedBy);
        break;
      case 'Delivered':
        await this.handleDeliveredSideEffects(tx, order, performedBy);
        break;
    }
  }

  private async handleConfirmedSideEffects(
    tx: Prisma.TransactionClient,
    orderId: string,
    performedBy?: string,
  ) {
    await this.takeCostSnapshot(orderId, tx);
    await this.verifyStockForOrder(orderId, tx);
  }

  private async handleCancelledSideEffects(
    tx: Prisma.TransactionClient,
    orderId: string,
    performedBy?: string,
  ) {
    await this.cancelReturnStock.restoreForOrder({
      orderId,
      referencePrefix: 'cancel',
      performedBy,
      tx,
    });
  }

  private async handleReturnedSideEffects(
    tx: Prisma.TransactionClient,
    orderId: string,
    performedBy?: string,
  ) {
    await this.cancelReturnStock.restoreForOrder({
      orderId,
      referencePrefix: 'return',
      performedBy,
      tx,
    });
  }


  private async handleDeliveredSideEffects(
    tx: Prisma.TransactionClient,
    order: any,
    performedBy?: string,
  ) {
    this.logger.log(`Order ${order.id} delivered — payment confirmation stub`);
  }

  private async takeCostSnapshot(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const order = await (tx || this.prisma).order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: { select: { standardCost: true, availabilityMode: true } },
            variant: { select: { standardCost: true } },
          },
        },
      },
    });

    if (!order) return;

    for (const item of order.items) {
      const cost = item.variant?.standardCost ?? item.product?.standardCost;
      if (cost != null) {
        await (tx || this.prisma).orderItem.update({
          where: { id: item.id },
          data: {
            costSnapshot: cost,
            costType: 'estimated',
          },
        });
      }
    }
  }

  private async verifyStockForOrder(
    orderId: string,
    tx: Prisma.TransactionClient,
  ) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                availabilityMode: true,
                manageStock: true,
                type: true,
                warehouseId: true,
                name: true,
                syncManagedStock: true,
              },
            },
            variant: { select: { id: true } },
          },
        },
      },
    });

    if (!order) return;

    // Resolve or create ACTIVE cycle
    let cycle = await tx.orderStockCycle.findFirst({
      where: { orderId, status: 'ACTIVE' },
    });
    if (!cycle) {
      cycle = await tx.orderStockCycle.create({
        data: { orderId, status: 'ACTIVE' },
      });
    }
    const cycleId = cycle.id;

    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

    for (const item of order.items) {
      // ── 1. Combo Items ───────────────────────────────────────────────────────
      if (item.comboId) {
        const components = await tx.orderItemComboComponent.findMany({
          where: { orderItemId: item.id },
          include: { product: true },
        });

        for (const comp of components) {
          const compProduct = comp.product;
          if (compProduct.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
            throw new BadRequestException(
              `Product "${compProduct.name}" in combo is out of stock and cannot be ordered`,
            );
          }

          // A. Managed Stock reserve if not already reserved
          if (compProduct.availabilityMode === 'MANAGED_STOCK' && compProduct.manageStock) {
            if (!comp.managedStockReserved) {
              const avail = await this.stockService.getAvailableStock(
                comp.productId,
                comp.variantId ?? undefined,
              );
              if (avail.available < comp.totalQuantity) {
                throw new BadRequestException(
                  `Insufficient managed stock for combo component "${compProduct.name}". Available: ${avail.available}, needed: ${comp.totalQuantity}.`,
                );
              }
              await this.stockService.operate('reserve', {
                productId: comp.productId,
                variantId: comp.variantId ?? undefined,
                quantity: comp.totalQuantity,
                reference: `Order Confirm Reserve: ${order.displayId}`,
                performedBy: 'system',
                tx,
              });
              await tx.orderItemComboComponent.update({
                where: { id: comp.id },
                data: { managedStockReserved: true },
              });
            }
          }

          // B. Physical Stock reserve if applicable and IM is ON
          const decision = this.stockRouter.resolve(
            compProduct.availabilityMode, 'allocate',
            imEnabled, compProduct.syncManagedStock ?? undefined,
          );

          if (decision.pi !== 'skip') {
            let compWhId = compProduct.warehouseId;
            if (!compWhId) {
              const firstStock = await tx.physicalInventory.findFirst({
                where: {
                  productId: comp.productId,
                  variantId: comp.variantId || null,
                },
                select: { warehouseId: true },
              });
              compWhId = firstStock?.warehouseId || null;
            }

            if (!compWhId) {
              throw new BadRequestException(
                `"${compProduct.name}" in combo has no physical stock record. Cannot confirm order without physical stock when Inventory Management is active.`,
              );
            }

            const alreadyReserved = await this.stockService.hasExistingPhysicalReservation(
              orderId,
              undefined,
              comp.id,
              cycleId,
            );

            if (!alreadyReserved) {
              const existingPi = await tx.physicalInventory.findFirst({
                where: {
                  productId: comp.productId,
                  variantId: comp.variantId || null,
                  warehouseId: compWhId,
                },
              });
              if (!existingPi) {
                throw new BadRequestException(
                  `"${compProduct.name}" in combo has no physical stock record in warehouse. Cannot confirm order.`,
                );
              }
              const availablePhysical = existingPi.quantity - existingPi.reservedQuantity;
              if (availablePhysical < comp.totalQuantity) {
                throw new BadRequestException(
                  `Insufficient physical stock for combo component "${compProduct.name}". Available: ${availablePhysical}, needed: ${comp.totalQuantity}.`,
                );
              }

              await this.stockService.reservePhysicalAllocated({
                orderId,
                cycleId,
                comboComponentId: comp.id,
                productId: comp.productId,
                variantId: comp.variantId ?? undefined,
                warehouseId: compWhId,
                quantity: comp.totalQuantity,
                tx,
              });
            }
          }
        }
        continue;
      }

      // ── 2. Standalone Items ──────────────────────────────────────────────────
      const product = item.product;
      if (!product) continue;
      if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
        throw new BadRequestException(
          `Product "${product.name}" is out of stock and cannot be ordered`,
        );
      }

      if (product.availabilityMode === 'MANAGED_STOCK') {
        if (product.manageStock) {
          if (!item.managedStockReserved) {
            const avail = await this.stockService.getAvailableStock(
              item.productId!,
              item.variantId ?? undefined,
            );
            if (avail.available < item.quantity) {
              throw new BadRequestException(
                `Insufficient stock for "${product.name}". Available: ${avail.available}, needed: ${item.quantity}.`,
              );
            }

            await this.resolveAndApplyStock(
              'reserve',
              item.productId!,
              item.variantId ?? undefined,
              item.quantity,
              order.displayId,
              tx,
              {
                orderId,
                orderItemId: item.id,
              },
            );
          }

          const decision = this.stockRouter.resolve(
            product.availabilityMode, 'allocate',
            imEnabled, product.syncManagedStock ?? undefined,
          );

          if (decision.pi !== 'skip') {
            let whId = product.warehouseId;
            if (!whId) {
              const firstStock = await tx.physicalInventory.findFirst({
                where: {
                  productId: item.productId!,
                  variantId: item.variantId || null,
                },
                select: { warehouseId: true },
              });
              whId = firstStock?.warehouseId || null;
            }

            if (!whId) {
              throw new BadRequestException(
                `"${product.name}" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই। ` +
                `Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।`,
              );
            }

            const alreadyReserved = await this.stockService.hasExistingPhysicalReservation(
              orderId,
              item.id,
              undefined,
              cycleId,
            );
            if (!alreadyReserved) {
              const existingPi = await tx.physicalInventory.findFirst({
                where: {
                  productId: item.productId!,
                  variantId: item.variantId || null,
                  warehouseId: whId,
                },
              });
              if (!existingPi) {
                throw new BadRequestException(
                  `"${product.name}" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই। ` +
                  `Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।`,
                );
              }
              const availablePhysical = existingPi.quantity - existingPi.reservedQuantity;
              if (availablePhysical < item.quantity) {
                throw new BadRequestException(
                  `"${product.name}" এর Physical Stock অপর্যাপ্ত। ` +
                  `Available: ${availablePhysical}, Needed: ${item.quantity}। ` +
                  `Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।`,
                );
              }
              await this.stockService.reservePhysicalAllocated({
                orderId,
                cycleId,
                orderItemId: item.id,
                productId: item.productId!,
                variantId: item.variantId ?? undefined,
                warehouseId: whId,
                quantity: item.quantity,
                tx,
              });
            }
          }
        }
      }

      if (product.availabilityMode === 'INVENTORY_CONTROLLED') {
        if (imEnabled) {
          let icWhId = product.warehouseId;
          if (!icWhId) {
            const firstStock = await tx.physicalInventory.findFirst({
              where: {
                productId: item.productId!,
                variantId: item.variantId || null,
              },
              select: { warehouseId: true },
            });
            icWhId = firstStock?.warehouseId || null;
          }

          if (icWhId) {
            const alreadyReserved = await this.stockService.hasExistingPhysicalReservation(
              orderId,
              item.id,
              undefined,
              cycleId,
            );
            if (!alreadyReserved) {
              const existingPi = await tx.physicalInventory.findFirst({
                where: {
                  productId: item.productId!,
                  variantId: item.variantId || null,
                  warehouseId: icWhId,
                },
              });
              if (!existingPi) {
                throw new BadRequestException(
                  `Insufficient physical stock for "${product.name}". No physical inventory record found.`,
                );
              }
              const availablePhysical = existingPi.quantity - existingPi.reservedQuantity;
              if (availablePhysical < item.quantity) {
                throw new BadRequestException(
                  `Insufficient physical stock for "${product.name}". Available: ${availablePhysical}, needed: ${item.quantity}.`,
                );
              }
              await this.stockService.reservePhysicalAllocated({
                orderId,
                cycleId,
                orderItemId: item.id,
                productId: item.productId!,
                variantId: item.variantId ?? undefined,
                warehouseId: icWhId,
                quantity: item.quantity,
                tx,
              });
            } else {
              const physAvail = await this.stockService.checkPhysicalAvailability(
                item.productId!,
                icWhId,
                item.variantId ?? undefined,
              );
              if (physAvail.availableStock < 0) {
                throw new BadRequestException(
                  `Insufficient physical stock for "${product.name}". Available: ${physAvail.availableStock}, needed: ${item.quantity}.`,
                );
              }
            }
          }
        }
      }
    }
  }



  private async firePurchaseInstant(order: any) {
    try {
      const settings = await this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'tracking_meta_purchase_mode',
              'tracking_tiktok_purchase_mode',
            ],
          },
        },
      });
      const settingMap = Object.fromEntries(
        settings.map((s: any) => [s.key, s.value]),
      );
      const metaInstant =
        (settingMap['tracking_meta_purchase_mode'] || 'instant') === 'instant';
      const tiktokInstant =
        (settingMap['tracking_tiktok_purchase_mode'] || 'instant') ===
        'instant';

      if (!metaInstant && !tiktokInstant) return;

      await this.buildAndSendPurchaseEvent(order, 'instant');
    } catch (err) {
      this.logger.error('Failed to fire instant purchase event:', err);
    }
  }

  private async firePurchaseValidated(statusName: string, order: any) {
    try {
      const settings = await this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'tracking_meta_validated_status',
              'tracking_tiktok_validated_status',
            ],
          },
        },
      });
      const settingMap = Object.fromEntries(
        settings.map((s: any) => [s.key, s.value]),
      );
      const metaStatus = settingMap['tracking_meta_validated_status'] || '';
      const tiktokStatus = settingMap['tracking_tiktok_validated_status'] || '';

      if (metaStatus !== statusName && tiktokStatus !== statusName) return;

      await this.buildAndSendPurchaseEvent(order, 'validated');
    } catch (err) {
      this.logger.error('Failed to fire validated purchase event:', err);
    }
  }

  private async buildAndSendPurchaseEvent(
    order: any,
    mode: 'instant' | 'validated',
  ) {
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
      content_ids: itemsList
        .map((i: any) => i.productId || i.comboId || '')
        .filter(Boolean),
      num_items: itemsList.reduce(
        (s: number, i: any) => s + (i.quantity || 0),
        0,
      ),
      order_id: order.id,
      contents: itemsList.map((i: any) => ({
        id: i.productId || i.comboId || '',
        quantity: i.quantity,
        item_price: Number(i.price),
      })),
    };

    const createdAt = order.createdAt
      ? Math.floor(new Date(order.createdAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const actionSource =
      order.salesChannel === 'WEBSITE' ? 'website' : 'physical_store';

    await this.tracking.track({
      eventName: 'purchase',
      eventTime: createdAt,
      eventId: `purchase_${order.id}`,
      actionSource,
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
  }

  private async fireRefundEvent(order: any) {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: 'tracking_refund_enabled' },
      });
      if (setting?.value === 'false') return;

      const itemsList = (order.items as any[]) || [];
      const totalValue = Number(order.total || 0);
      if (totalValue <= 0) return;

      const savedCtx = await this.tracking.getContext(order.id);

      let phone = '';
      let firstName = '';
      const country = 'BD';
      if (order.customer) {
        phone = order.customer.phoneNumber || '';
        firstName = order.customer.firstName || '';
      }
      if (!phone) phone = order.guestPhone || '';
      if (!firstName) firstName = order.guestName || '';

      const actionSource =
        order.salesChannel === 'WEBSITE' ? 'website' : 'physical_store';

      await this.tracking.track({
        eventName: 'purchase',
        eventTime: Math.floor(Date.now() / 1000),
        eventId: `refund_${order.id}`,
        actionSource,
        userData: {
          phone,
          name: firstName || undefined,
          country,
          ip: '',
          userAgent: '',
          fbp: savedCtx?.fbp || undefined,
          fbc: savedCtx?.fbc || undefined,
        },
        customData: {
          value: -totalValue,
          currency: 'BDT',
          content_ids: itemsList
            .map((i: any) => i.productId || i.comboId || '')
            .filter(Boolean),
          order_id: order.id,
          num_items: itemsList.reduce(
            (s: number, i: any) => s + (i.quantity || 0),
            0,
          ),
        },
      });
    } catch (err) {
      this.logger.error('Failed to fire refund event:', err);
    }
  }
}
