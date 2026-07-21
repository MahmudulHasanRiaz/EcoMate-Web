import {
  Injectable,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';
import { HoldCartDto } from './dto/hold-cart.dto';

@Injectable()
export class PosOrdersService {
  private readonly logger = new Logger(PosOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly stockRouter: StockRouterService,
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

  private async generateDisplayId(): Promise<string> {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yy}${mm}${dd}`;
    const prefix = `POS-${dateStr}`;

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: dateStr },
        create: { date: dateStr, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      return `${prefix}-${String(counter.seq).padStart(4, '0')}`;
    });
  }

  /**
   * Validate all items and return authoritative priced items fetched from the DB.
   * Must be called inside a Prisma transaction (tx) to close the TOCTOU window.
   */
  private async validateAndFetchAuthoritativeItems(
    dto: CreatePosOrderDto,
    tx: any,
  ): Promise<
    Array<{
      productId?: string;
      variantId?: string;
      comboId?: string;
      comboSelection?: Record<string, string>;
      quantity: number;
      price: number;
      discount?: number;
      discountType?: string;
    }>
  > {
    const productIds = [
      ...new Set(
        dto.items
          .filter((i) => i.productId && !i.variantId && !i.comboId)
          .map((i) => i.productId!),
      ),
    ];
    const variantIds = [
      ...new Set(
        dto.items.filter((i) => i.variantId).map((i) => i.variantId!),
      ),
    ];
    const comboIds = [
      ...new Set(
        dto.items.filter((i) => i.comboId && !i.variantId).map((i) => i.comboId!),
      ),
    ];

    const [products, variants, combos] = await Promise.all([
      productIds.length
        ? tx.product.findMany({
            where: { id: { in: productIds } },
            select: {
              id: true,
              isActive: true,
              basePrice: true,
              salePrice: true,
              name: true,
            },
          })
        : (Promise.resolve([]) as Promise<any[]>),
      variantIds.length
        ? tx.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              isActive: true,
              price: true,
              salePrice: true,
              productId: true,
              product: {
                select: { id: true, isActive: true, name: true },
              },
            },
          })
        : (Promise.resolve([]) as Promise<any[]>),
      comboIds.length
        ? tx.combo.findMany({
            where: { id: { in: comboIds } },
            select: {
              id: true,
              isActive: true,
              basePrice: true,
              salePrice: true,
              name: true,
            },
          })
        : (Promise.resolve([]) as Promise<any[]>),
    ]);

    const productMap: Map<string, any> = new Map(products.map((p: any) => [p.id, p]));
    const variantMap: Map<string, any> = new Map(variants.map((v: any) => [v.id, v]));
    const comboMap: Map<string, any> = new Map(combos.map((c: any) => [c.id, c]));

    return dto.items.map((item) => {
      if (!item.productId && !item.variantId && !item.comboId) {
        throw new BadRequestException(
          'Each item must have at least one of productId, variantId, or comboId',
        );
      }

      if (item.quantity <= 0) {
        throw new BadRequestException(
          `Invalid quantity ${item.quantity} for item`,
        );
      }

      let effectivePrice: number;

      if (item.variantId) {
        const variant = variantMap.get(item.variantId);
        if (!variant) {
          throw new BadRequestException(
            `Variant ${item.variantId} not found`,
          );
        }
        if (!variant.isActive) {
          throw new BadRequestException(
            `Variant ${item.variantId} is inactive`,
          );
        }
        // Reject variant-product mismatch
        if (item.productId && item.productId !== variant.productId) {
          throw new BadRequestException(
            `Variant ${item.variantId} does not belong to product ${item.productId}`,
          );
        }
        if (!variant.product.isActive) {
          throw new BadRequestException(
            `Product ${variant.productId} for variant ${item.variantId} is inactive`,
          );
        }

        effectivePrice = Number(variant.salePrice ?? variant.price ?? 0);
        const clientPrice = Number(item.price);
        if (Math.abs(clientPrice - effectivePrice) > 0.005) {
          throw new BadRequestException(
            `Price mismatch for variant ${item.variantId}: client ${clientPrice} vs DB ${effectivePrice}`,
          );
        }
      } else if (item.productId) {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new BadRequestException(
            `Product ${item.productId} not found`,
          );
        }
        if (!product.isActive) {
          throw new BadRequestException(
            `Product ${item.productId} is inactive`,
          );
        }

        effectivePrice = Number(product.salePrice ?? product.basePrice);
        const clientPrice = Number(item.price);
        if (Math.abs(clientPrice - effectivePrice) > 0.005) {
          throw new BadRequestException(
            `Price mismatch for product ${item.productId}: client ${clientPrice} vs DB ${effectivePrice}`,
          );
        }
      } else if (item.comboId) {
        const combo = comboMap.get(item.comboId);
        if (!combo) {
          throw new BadRequestException(`Combo ${item.comboId} not found`);
        }
        if (!combo.isActive) {
          throw new BadRequestException(
            `Combo ${item.comboId} is inactive`,
          );
        }

        effectivePrice = Number(combo.salePrice ?? combo.basePrice);
        const clientPrice = Number(item.price);
        if (Math.abs(clientPrice - effectivePrice) > 0.005) {
          throw new BadRequestException(
            `Price mismatch for combo ${item.comboId}: client ${clientPrice} vs DB ${effectivePrice}`,
          );
        }
      } else {
        // Should not reach here due to check above, but satisfies TS exhaustiveness
        effectivePrice = 0;
      }

      return {
        productId: item.productId,
        variantId: item.variantId,
        comboId: item.comboId,
        comboSelection: item.comboSelection,
        quantity: item.quantity,
        price: effectivePrice,
        discount: item.discount,
        discountType: item.discountType,
      };
    });
  }

  private validateDiscount(
    discount: number | undefined,
    discountType: string | undefined,
    subtotal: number,
  ): void {
    if (discount == null || discount === 0) return;

    if (!Number.isFinite(discount)) {
      throw new BadRequestException('Discount must be a finite number');
    }

    if (discountType === 'percentage') {
      if (discount < 0) {
        throw new BadRequestException(
          'Percentage discount cannot be negative',
        );
      }
      if (discount > 100) {
        throw new BadRequestException(
          'Percentage discount cannot exceed 100',
        );
      }
    } else {
      if (discount < 0) {
        throw new BadRequestException('Flat discount cannot be negative');
      }
      if (discount > subtotal) {
        throw new BadRequestException(
          'Flat discount cannot exceed subtotal',
        );
      }
    }
  }

  /**
   * Validates that provided payments sum exactly to the order total.
   * POS orders always set PAID status, so exact reconciliation is required.
   * When no payments are provided, a single CASH payment for the full total
   * is created by the caller (always exact).
   */
  private validatePaymentsExact(
    payments: { amount: number }[] | undefined,
    total: number,
  ): void {
    if (!payments?.length) return;

    const sum = payments.reduce((acc, p) => acc + p.amount, 0);
    const roundedSum = Math.round(sum * 100) / 100;
    const roundedTotal = Math.round(total * 100) / 100;

    if (roundedSum > roundedTotal) {
      throw new BadRequestException(
        `Payment total ${roundedSum} exceeds order total ${roundedTotal}`,
      );
    }
    if (roundedSum < roundedTotal) {
      throw new BadRequestException(
        `Payment total ${roundedSum} is less than order total ${roundedTotal}. Exact payment required for POS orders.`,
      );
    }
  }

  private recalculate(
    items: {
      price: number;
      quantity: number;
      discount?: number;
      discountType?: string;
    }[],
    orderDiscount: number,
    orderDiscountType: string,
  ) {
    let subtotal = 0;
    let totalItemDiscount = 0;

    for (const item of items) {
      const lineTotal = item.price * item.quantity;
      subtotal += lineTotal;
      if (item.discount) {
        // Validate item-level discount against its own line total
        if (!Number.isFinite(item.discount)) {
          throw new BadRequestException('Item discount must be a finite number');
        }
        if (item.discountType === 'percentage') {
          if (item.discount < 0) throw new BadRequestException('Item percentage discount cannot be negative');
          if (item.discount > 100) throw new BadRequestException('Item percentage discount cannot exceed 100');
        } else {
          if (item.discount < 0) throw new BadRequestException('Item flat discount cannot be negative');
          if (item.discount > lineTotal) throw new BadRequestException('Item flat discount cannot exceed line total');
        }
        totalItemDiscount +=
          item.discountType === 'percentage'
            ? (lineTotal * item.discount) / 100
            : item.discount;
      }
    }

    const afterItemDiscount = subtotal - totalItemDiscount;
    let orderDiscountVal = 0;
    if (orderDiscount) {
      orderDiscountVal =
        orderDiscountType === 'percentage'
          ? (afterItemDiscount * orderDiscount) / 100
          : orderDiscount;
    }

    const total = subtotal - totalItemDiscount - orderDiscountVal;
    return { subtotal, total, discount: totalItemDiscount + orderDiscountVal };
  }

  private async getDescendantCategoryIds(
    categoryId: string,
  ): Promise<string[]> {
    const children = await this.prisma.category.findMany({
      where: { parentId: categoryId, isActive: true },
      select: { id: true },
    });
    const ids = children.map((c) => c.id);
    for (const childId of [...ids]) {
      ids.push(...(await this.getDescendantCategoryIds(childId)));
    }
    return ids;
  }

  async findCustomerByPhone(phone: string) {
    return this.prisma.userProfile.findFirst({
      where: { phoneNumber: phone, role: 'customer' },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    });
  }

  async quickCreateCustomer(phone: string, name?: string) {
    const existing = await this.prisma.userProfile.findFirst({
      where: { phoneNumber: phone, role: 'customer' },
    });
    if (existing) return existing;

    const domain = this.getEmailDomain();

    return this.prisma.userProfile.create({
      data: {
        firstName: name || phone,
        lastName: '',
        username: `cust_${phone.replace(/[^0-9]/g, '')}`,
        email: `${phone.replace(/[^0-9]/g, '')}@${domain}`,
        phoneNumber: phone,
        password: '',
        role: 'customer',
        status: 'active',
      },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    });
  }

  async create(
    dto: CreatePosOrderDto,
    sessionId: string,
    cashierId: string,
    idempotencyKey?: string,
  ) {
    const session = await this.prisma.posSession.findUnique({
      where: { id: sessionId },
      include: { showroom: true },
    });
    if (!session) {
      throw new BadRequestException('POS session not found');
    }
    if (session.status !== 'open') {
      throw new BadRequestException('POS session is not active');
    }
    if (session.cashierId !== cashierId) {
      throw new BadRequestException(
        'Session does not belong to this cashier',
      );
    }

    // Idempotency check: if key provided and already processed, return existing order
    if (idempotencyKey) {
      const existing = await this.prisma.order.findFirst({
        where: { idempotencyKey, trashedAt: null },
        include: { items: true, payments: true, customer: true },
      });
      if (existing) {
        this.logger.warn(
          `Idempotent request — returning existing order ${existing.displayId} (key: ${idempotencyKey})`,
        );
        return existing;
      }
    }

    const displayId = await this.generateDisplayId();

    // Everything that reads or writes DB prices/stock happens inside a single
    // Prisma transaction to close the TOCTOU (time-of-check-time-of-use) window.
    return this.prisma.$transaction(async (tx) => {
      // Server-authoritative pricing and item validation INSIDE transaction
      const authItems =
        await this.validateAndFetchAuthoritativeItems(dto, tx);

      // Server-side discount validation using authoritative prices
      const authSubtotal = authItems.reduce(
        (sum, i) => sum + i.price * i.quantity,
        0,
      );
      this.validateDiscount(dto.discount, dto.discountType, authSubtotal);

      // Recalculate using authoritative prices
      const { subtotal, total, discount } = this.recalculate(
        authItems,
        dto.discount || 0,
        dto.discountType || 'flat',
      );

      // Exact payment split reconciliation (POS always sets PAID status)
      this.validatePaymentsExact(dto.payments, total);

      const deliveryMethod = dto.deliveryMethod || 'Counter Sale';
      const isInstantDelivery = ['Counter Sale', 'Takeaway'].includes(
        deliveryMethod,
      );

      const statusName = isInstantDelivery ? 'delivered' : 'confirmed';
      const status = await tx.orderStatus.findFirst({
        where: { name: { equals: statusName, mode: 'insensitive' } },
      });
      if (!status)
        throw new BadRequestException(
          `Status "${statusName}" not found. Please create an order status named "${isInstantDelivery ? 'Delivered' : 'Confirmed'}" in settings.`,
        );

      const order = await tx.order.create({
        data: {
          displayId,
          idempotencyKey,
          statusId: status.id,
          subtotal,
          shippingCharge: 0,
          discount,
          discountType: 'flat',
          total,
          source: 'POS',
          salesChannel: dto.salesChannel || 'WALK_IN',
          posSessionId: sessionId,
          customerId: dto.customerId,
          guestName: dto.guestName,
          guestPhone: dto.guestPhone,
          customerNotes: dto.notes,
          paymentStatus: 'PAID',
          timeline: [
            {
              type: 'created',
              by: cashierId,
              at: new Date().toISOString(),
            },
            {
              type: 'payment',
              status: 'PAID',
              at: new Date().toISOString(),
            },
          ],
        },
      });

      // Persist order items with authoritative DB prices
      for (const item of authItems) {
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: item.productId,
            variantId: item.variantId,
            comboId: item.comboId,
            comboSelection: item.comboSelection as any,
            quantity: item.quantity,
            price: item.price,
          },
        });
      }

      const imEnabled =
        await this.stockRouter.isInventoryManagementEnabled();

      for (const item of authItems) {
        if (imEnabled) {
          // POS has no reservation flow — use addPhysical with negative qty
          // to decrement quantity only (skips reservedQuantity decrement)
          await this.stock.addPhysical({
            productId: item.productId,
            variantId: item.variantId,
            comboId: item.comboId,
            comboSelection: item.comboSelection,
            quantity: -item.quantity,
            reference: displayId,
            performedBy: cashierId,
            warehouseId: session.showroom.id,
            ledgerType: 'POS_SALE',
            tx,
          });
        } else {
          const product = item.productId
            ? await tx.product.findUnique({
                where: { id: item.productId },
                select: { availabilityMode: true },
              })
            : null;
          const decision = this.stockRouter.resolve(
            product?.availabilityMode,
            'deduct',
            false,
          );

          if (decision.ms === 'deduct') {
            // POS skips reserve step; reserve then deduct so reservedStock ends at 0
            await this.stock.reserve({
              productId: item.productId,
              variantId: item.variantId,
              comboId: item.comboId,
              comboSelection: item.comboSelection,
              quantity: item.quantity,
              reference: displayId,
              performedBy: cashierId,
              tx,
            });
            await this.stock.deduct({
              productId: item.productId,
              variantId: item.variantId,
              comboId: item.comboId,
              comboSelection: item.comboSelection,
              quantity: item.quantity,
              reference: displayId,
              performedBy: cashierId,
              tx,
            });
          }
        }
      }

      if (dto.payments?.length) {
        for (const pm of dto.payments) {
          await tx.payment.create({
            data: {
              orderId: order.id,
              amount: pm.amount,
              gatewayCode: pm.method,
              status: 'PAID',
              verifiedBy: cashierId,
              verifiedAt: new Date(),
            },
          });
        }
      } else {
        await tx.payment.create({
          data: {
            orderId: order.id,
            amount: total,
            gatewayCode: 'CASH',
            status: 'PAID',
            verifiedBy: cashierId,
            verifiedAt: new Date(),
          },
        });
      }

      return tx.order.findFirst({
        where: { id: order.id, trashedAt: null },
        include: { items: true, payments: true, customer: true },
      });
    });
  }

  async findProducts(query: {
    search?: string;
    categoryId?: string;
    barcode?: string;
    page?: number;
    perPage?: number;
  }) {
    const where: any = { isActive: true };

    if (query.barcode) {
      where.OR = [
        { sku: query.barcode },
        { variants: { some: { sku: query.barcode } } },
      ];
    } else if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        {
          variants: {
            some: { sku: { contains: query.search, mode: 'insensitive' } },
          },
        },
      ];
    }

    if (query.categoryId) {
      const descendantIds = await this.getDescendantCategoryIds(
        query.categoryId,
      );
      where.productCategories = {
        some: { categoryId: { in: [query.categoryId, ...descendantIds] } },
      };
    }

    const page = query.page || 1;
    const perPage = query.perPage || 50;

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          variants: {
            where: { isActive: true },
            include: {
              attributeValues: {
                include: {
                  attributeValue: {
                    include: {
                      attribute: true,
                    },
                  },
                },
              },
            },
          },
          category: true,
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, perPage };
  }
}
