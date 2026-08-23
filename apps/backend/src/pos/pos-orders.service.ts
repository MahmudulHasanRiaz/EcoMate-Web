import {
  Injectable,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { dhakaDateParts } from '../common/utils/dhaka-time';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';
import { HoldCartDto } from './dto/hold-cart.dto';
import { ValidateStockDto, StockValidationResult, StockValidationItemResult, AlternativeSourceDto } from './dto/validate-stock.dto';
import { CreatePosTransferRequestDto } from './dto/create-transfer-request.dto';
import { MediaResolverService } from '../media/media-resolver.service';
import { TrackingCaptureService } from '../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../tracking/tracking-settings.service';
import { resolveActionSource } from '../tracking/meta-action-source';
import { Prisma } from '@prisma/client';
import { CommissionsService } from '../commissions/commissions.service';

@Injectable()
export class PosOrdersService {
  private readonly logger = new Logger(PosOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly stockRouter: StockRouterService,
    @Inject(ConfigService) private config: ConfigService,
    private readonly mediaResolver: MediaResolverService,
    private readonly trackingCapture: TrackingCaptureService,
    private readonly trackingSettings: TrackingSettingsService,
    private readonly commissionsService: CommissionsService,
  ) {}

  private mediaUrls(value: unknown): string[] {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.mediaUrls(entry));
    }
    if (!value || typeof value !== 'object') return [];

    const record = value as Record<string, unknown>;
    for (const candidate of [record.url, record.src, record.path]) {
      const resolved = this.mediaUrls(candidate);
      if (resolved.length > 0) return resolved;
    }
    return [];
  }

  private async enrichProductMedia(products: any[]): Promise<void> {
    const urls = new Set<string>();
    for (const product of products) {
      this.mediaUrls(product.images).forEach((url) => urls.add(url));
      this.mediaUrls(product.image).forEach((url) => urls.add(url));
      for (const variant of product.variants || []) {
        this.mediaUrls(variant.images).forEach((url) => urls.add(url));
        this.mediaUrls(variant.image).forEach((url) => urls.add(url));
      }
    }
    if (urls.size === 0) return;

    const resolved = await this.mediaResolver.resolve([...urls]);
    for (const product of products) {
      const metadata: Record<string, unknown> = {};
      const productUrls = [
        ...this.mediaUrls(product.images),
        ...this.mediaUrls(product.image),
      ];
      for (const variant of product.variants || []) {
        productUrls.push(
          ...this.mediaUrls(variant.images),
          ...this.mediaUrls(variant.image),
        );
      }
      for (const url of productUrls) {
        if (resolved[url]) metadata[url] = resolved[url];
      }
      product._mediaMeta = metadata;
    }
  }

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
    const { year, month, day } = dhakaDateParts();
    const yy = String(year).slice(2);
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
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
      sourceWarehouseId?: string;
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
        sourceWarehouseId: item.sourceWarehouseId,
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
    const order = await this.prisma.$transaction(async (tx) => {
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
          salesChannel: dto.salesChannel || 'POS',
          sourcePlatform: 'POS',
          sourceType: 'SHOWROOM',
          sourceEntity: (session.showroom as any)?.name || null,
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
            sourceWarehouseId: item.sourceWarehouseId || null,
            quantity: item.quantity,
            price: item.price,
          },
        });
      }

      const imEnabled =
        await this.stockRouter.isInventoryManagementEnabled();

      for (const item of authItems) {
        // When sourceWarehouseId is set and differs from current showroom,
        // skip stock deduction — Order Management handles fulfillment later.
        const isCrossWarehouse =
          item.sourceWarehouseId &&
          item.sourceWarehouseId !== session.showroom.id;

        if (isCrossWarehouse) continue;

        if (item.comboId) {
          // Combos: resolve each component's availability mode independently,
          // exactly like the order flow and shared delivery deduction service.
          const combo = await tx.combo.findUnique({
            where: { id: item.comboId },
            include: { items: true },
          });
          if (!combo) continue;
          for (const ci of combo.items) {
            const compProduct = await tx.product.findUnique({
              where: { id: ci.productId },
              select: { availabilityMode: true, manageStock: true },
            });
            const compVariantId = ci.variantId || (item.comboSelection as any)?.[ci.productId] || null;
            const compQty = ci.quantity * item.quantity;
            const compDecision = this.stockRouter.resolve(
              compProduct?.availabilityMode,
              'deduct',
              imEnabled,
            );

            if (imEnabled && compDecision.pi !== 'skip') {
              await this.stock.addPhysical({
                productId: ci.productId,
                variantId: compVariantId,
                quantity: -compQty,
                reference: displayId,
                performedBy: cashierId,
                warehouseId: session.showroom.id,
                ledgerType: 'POS_SALE',
                tx,
              });
            }
            if (compDecision.ms === 'deduct') {
              await this.stock.reserve({
                productId: ci.productId,
                variantId: compVariantId || undefined,
                quantity: compQty,
                reference: displayId,
                performedBy: cashierId,
                tx,
              });
              await this.stock.deduct({
                productId: ci.productId,
                variantId: compVariantId || undefined,
                quantity: compQty,
                reference: displayId,
                performedBy: cashierId,
                tx,
              });
            }
          }
          continue;
        }

        // Resolve per-product availability mode with the REAL IM flag so POS
        // honours both engines (managed stock + physical) just like the order flow.
        const product = item.productId
          ? await tx.product.findUnique({
              where: { id: item.productId },
              select: { availabilityMode: true, manageStock: true },
            })
          : null;
        const decision = this.stockRouter.resolve(
          product?.availabilityMode,
          'deduct',
          imEnabled,
        );

        // Physical deduction (IM ON): decrement physical quantity at the showroom.
        if (imEnabled && decision.pi !== 'skip') {
          await this.stock.addPhysical({
            productId: item.productId,
            variantId: item.variantId,
            quantity: -item.quantity,
            reference: displayId,
            performedBy: cashierId,
            warehouseId: session.showroom.id,
            ledgerType: 'POS_SALE',
            tx,
          });
        }

        // Managed deduction (per-mode): reserve then deduct so reservedStock
        // ends at 0 — mirrors the IM-OFF branch, but also runs under IM ON for
        // MANAGED_STOCK products.
        if (decision.ms === 'deduct') {
          await this.stock.reserve({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            reference: displayId,
            performedBy: cashierId,
            tx,
          });
          await this.stock.deduct({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            reference: displayId,
            performedBy: cashierId,
            tx,
          });
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

      // Capture the offline Purchase snapshot inside the same transaction as
      // the order insert (idempotent). POS sales are completed at the till, so
      // the event fires regardless of purchase mode — action_source is always
      // physical_store for Meta offline attribution. Wrapped so a capture-side
      // failure can never roll back the order.
      try {
        const trackOrder = await tx.order.findUnique({
          where: { id: order.id },
          include: {
            customer: true,
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    category: { select: { name: true } },
                  },
                },
                combo: { select: { id: true, name: true } },
              },
            },
          },
        });
        if (trackOrder) {
          await this.fireOfflinePurchase(trackOrder as any, tx);
        }
      } catch (err) {
        this.logger.error(
          `Failed to capture offline purchase snapshot for order ${order.id}:`,
          err,
        );
      }

      return tx.order.findFirst({
        where: { id: order.id, trashedAt: null },
        include: { items: true, payments: true, customer: true },
      });
    });

    // Commission hook (decision #5): a POS order is created already in a
    // terminal status ('Confirmed' for delivery, 'Delivered' for counter/takeaway).
    // Evaluate active commission rules. Resilient — never breaks the sale.
    if (order) {
      try {
        await this.commissionsService.processOrderCommissions(order.id);
      } catch (err) {
        this.logger.error(
          `Commission hook failed for POS order ${order.id}:`,
          err,
        );
      }
    }

    return order;
  }

  private async fireOfflinePurchase(
    order: any,
    tx?: Prisma.TransactionClient,
  ) {
    try {
      let email = '';
      let phone = '';
      let firstName = '';
      let lastName = '';

      if (order.customer) {
        email = order.customer.email || '';
        firstName = order.customer.name || '';
        lastName = order.customer.lastName || '';
        phone = order.customer.phoneNumber || order.customer.phone || '';
      }
      if (!phone) phone = order.guestPhone || '';
      if (!firstName) firstName = order.guestName || '';

      const itemsList = (order.items as any[]) || [];
      const totalValue = Number(order.total || 0);
      const firstItem = itemsList[0];
      const contentName = firstItem
        ? firstItem.product?.name || firstItem.combo?.name || undefined
        : undefined;
      const contentCategory = firstItem?.product?.category?.name || undefined;

      const configSnapshot = await this.trackingSettings.buildConfigSnapshot();

      await this.trackingCapture.capture(
        {
          eventId: `purchase_${order.id}`,
          eventType: 'Purchase',
          orderId: order.displayId || order.id,
          ctxId: order.trackingSessionId || undefined,
          eventTime: Math.floor(
            new Date(order.createdAt).getTime() / 1000,
          ),
          actionSource: resolveActionSource(order),
          payload: {
            value: totalValue,
            currency: (configSnapshot as any).currency || 'BDT',
            content_ids: itemsList
              .map((i: any) => i.productId || i.comboId || '')
              .filter(Boolean),
            content_type: 'product',
            content_name: contentName,
            content_category: contentCategory,
            contents: itemsList.map((i: any) => ({
              id: i.productId || i.comboId || '',
              quantity: i.quantity,
              item_price: Number(i.price),
            })),
            num_items: itemsList.reduce(
              (s: number, i: any) => s + (i.quantity || 0),
              0,
            ),
            customerId: order.customerId ?? undefined,
            orderId: order.id,
            customer: {
              email: email || undefined,
              phone: phone || undefined,
              firstName: firstName || undefined,
              lastName: lastName || undefined,
              country: 'BD',
            },
          },
          configSnapshot,
        },
        tx,
      );
    } catch (err) {
      this.logger.error('Failed to fire offline purchase:', err);
    }
  }

  async getSessionShowroom(sessionId: string): Promise<{ showroomId: string }> {
    const session = await this.prisma.posSession.findUnique({
      where: { id: sessionId },
      select: { showroomId: true },
    });
    if (!session) {
      throw new BadRequestException('POS session not found');
    }
    return session;
  }

  async findProducts(query: {
    search?: string;
    categoryId?: string;
    barcode?: string;
    page?: number;
    perPage?: number;
    showroomId?: string;
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

    // Compute per-showroom stock availability when showroomId is provided
    if (query.showroomId) {
      const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
      const productIds = data.map((p: any) => p.id);
      const variantIds = data.flatMap((p: any) =>
        (p.variants || []).map((v: any) => v.id),
      );

      let physicalMap = new Map<string, { stock: number; reserved: number }>();

      if (imEnabled) {
        // Query physical inventory for current showroom (aggregate: for simple products, productId only; for variable, variantId)
        const physicalRecords = await this.prisma.physicalInventory.findMany({
          where: {
            warehouseId: query.showroomId,
            OR: [
              { productId: { in: productIds }, variantId: null },
              { variantId: { in: variantIds } },
            ],
          },
        });

        for (const rec of physicalRecords) {
          const key = rec.variantId || rec.productId;
          const existing = physicalMap.get(key);
          if (existing) {
            existing.stock += rec.quantity;
            existing.reserved += rec.reservedQuantity;
          } else {
            physicalMap.set(key, {
              stock: rec.quantity,
              reserved: rec.reservedQuantity,
            });
          }
        }
      }

      for (const product of data as any[]) {
        if (product.type === 'variable' && product.variants?.length) {
          for (const variant of product.variants) {
            let currentStock: number;
            let currentAvailable: number;
            if (imEnabled) {
              const entry = physicalMap.get(variant.id);
              currentStock = entry?.stock ?? 0;
              currentAvailable = (entry?.stock ?? 0) - (entry?.reserved ?? 0);
            } else {
              currentStock = variant.managedStockQuantity ?? 0;
              currentAvailable = (variant.managedStockQuantity ?? 0) - (variant.reservedStock ?? 0);
            }
            variant._showroomStock = currentStock;
            variant._showroomAvailable = currentAvailable;
          }
          // For variable products, overall stock = sum of variant stocks
          const totalStock = product.variants.reduce((s: number, v: any) => s + (v._showroomStock ?? 0), 0);
          const totalAvailable = product.variants.reduce((s: number, v: any) => s + (v._showroomAvailable ?? 0), 0);
          product._showroomStock = totalStock;
          product._showroomAvailable = totalAvailable;
        } else {
          if (imEnabled) {
            const entry = physicalMap.get(product.id);
            product._showroomStock = entry?.stock ?? 0;
            product._showroomAvailable = (entry?.stock ?? 0) - (entry?.reserved ?? 0);
          } else {
            product._showroomStock = product.managedStockQuantity ?? 0;
            product._showroomAvailable = (product.managedStockQuantity ?? 0) - (product.reservedStock ?? 0);
          }
        }

        // Compute total network stock across ALL warehouses
        if (imEnabled) {
          const networkRecords = await this.prisma.physicalInventory.findMany({
            where: {
              OR: [
                { productId: { in: productIds }, variantId: null },
                { variantId: { in: variantIds } },
              ],
            },
          });

          const networkMap = new Map<string, { stock: number; reserved: number }>();
          for (const rec of networkRecords) {
            const key = rec.variantId || rec.productId;
            const existing = networkMap.get(key);
            if (existing) {
              existing.stock += rec.quantity;
              existing.reserved += rec.reservedQuantity;
            } else {
              networkMap.set(key, { stock: rec.quantity, reserved: rec.reservedQuantity });
            }
          }

          for (const product of data as any[]) {
            if (product.type === 'variable' && product.variants?.length) {
              for (const variant of product.variants) {
                const entry = networkMap.get(variant.id);
                variant._networkAvailable = (entry?.stock ?? 0) - (entry?.reserved ?? 0);
              }
              product._networkAvailable = product.variants.reduce(
                (s: number, v: any) => s + (v._networkAvailable ?? 0), 0,
              );
            } else {
              const entry = networkMap.get(product.id);
              product._networkAvailable = (entry?.stock ?? 0) - (entry?.reserved ?? 0);
            }
          }
        } else {
          // IM OFF: managedStockQuantity is the global total
          for (const product of data as any[]) {
            product._networkAvailable = product.managedStockQuantity ?? 0;
          }
        }
      }
    }

    await this.enrichProductMedia(data);
    return { data, total, page, perPage };
  }

  async validateStock(
    dto: ValidateStockDto,
    showroomId: string,
  ): Promise<StockValidationResult> {
    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

    const results: StockValidationItemResult[] = [];

    for (const item of dto.items) {
      let currentStock = 0;
      let currentAvailable = 0;

      if (imEnabled) {
        const availability = await this.stock.checkPhysicalAvailability(
          item.productId!,
          showroomId,
          item.variantId,
        );
        currentStock = availability.currentStock;
        currentAvailable = availability.availableStock;
      } else {
        const availability = await this.stock.getAvailableStock(
          item.productId!,
          item.variantId,
        );
        currentStock = availability.stock;
        currentAvailable = availability.available;
      }

      const available = currentAvailable >= item.quantity;

      // Query alternatives: other warehouses/showrooms with stock
      let alternatives: AlternativeSourceDto[] = [];
      if (!available) {
        const wherePhysical: any = {
          productId: item.productId,
          warehouseId: { not: showroomId },
          quantity: { gt: 0 },
        };
        if (item.variantId) wherePhysical.variantId = item.variantId;

        const otherLocations = await this.prisma.physicalInventory.findMany({
          where: wherePhysical,
          include: {
            warehouse: { select: { id: true, name: true, type: true } },
          },
          orderBy: { quantity: 'desc' },
        });

        // Deduplicate by warehouse
        const warehouseMap = new Map<string, AlternativeSourceDto>();
        for (const loc of otherLocations) {
          const key = loc.warehouse.id;
          const existing = warehouseMap.get(key);
          const avail = loc.quantity - loc.reservedQuantity;
          if (existing) {
            existing.stock += loc.quantity;
            existing.available += avail;
          } else {
            warehouseMap.set(key, {
              warehouseId: loc.warehouse.id,
              warehouseName: loc.warehouse.name,
              warehouseType: loc.warehouse.type,
              stock: loc.quantity,
              reserved: loc.reservedQuantity,
              available: avail,
            });
          }
        }
        alternatives = Array.from(warehouseMap.values())
          .filter((a) => a.available > 0)
          .sort((a, b) => b.available - a.available);
      }

      results.push({
        productId: item.productId,
        variantId: item.variantId,
        requested: item.quantity,
        available,
        currentStock,
        currentAvailable,
        alternatives,
      });
    }

    return {
      allAvailable: results.every((r) => r.available),
      items: results,
    };
  }

  async getProductAvailability(
    productId: string,
    showroomId: string,
    variantId?: string,
  ) {
    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

    let currentShowroom: any = {};
    if (imEnabled) {
      currentShowroom = await this.stock.checkPhysicalAvailability(
        productId,
        showroomId,
        variantId,
      );
    } else {
      const global = await this.stock.getAvailableStock(productId, variantId);
      currentShowroom = {
        currentStock: global.stock,
        reserved: global.reserved,
        availableStock: global.available,
      };
    }

    const wherePhysical: any = {
      productId,
      warehouseId: { not: showroomId },
      quantity: { gt: 0 },
    };
    if (variantId) wherePhysical.variantId = variantId;

    const networkRecords = await this.prisma.physicalInventory.findMany({
      where: wherePhysical,
      include: {
        warehouse: { select: { id: true, name: true, type: true } },
      },
      orderBy: { quantity: 'desc' },
    });

    const warehouseMap = new Map<string, any>();
    for (const rec of networkRecords) {
      const key = rec.warehouse.id;
      const existing = warehouseMap.get(key);
      const avail = rec.quantity - rec.reservedQuantity;
      if (existing) {
        existing.stock += rec.quantity;
        existing.available += avail;
      } else {
        warehouseMap.set(key, {
          warehouseId: rec.warehouse.id,
          warehouseName: rec.warehouse.name,
          warehouseType: rec.warehouse.type,
          stock: rec.quantity,
          reserved: rec.reservedQuantity,
          available: avail,
        });
      }
    }

    return {
      productId,
      variantId: variantId || null,
      currentShowroom: {
        warehouseId: showroomId,
        stock: currentShowroom.currentStock ?? currentShowroom.stock ?? 0,
        reserved: currentShowroom.reserved ?? 0,
        available: currentShowroom.availableStock ?? currentShowroom.available ?? 0,
      },
      network: Array.from(warehouseMap.values()).filter((w) => w.available > 0),
    };
  }

  async initiateTransfer(
    dto: CreatePosTransferRequestDto,
    cashierId: string,
    showroomId: string,
  ) {
    const transfers: Array<{
    id: string;
    productId: string;
    variantId?: string;
    quantity: number;
    sourceWarehouseId: string;
    status: string;
  }> = [];

    for (const item of dto.items) {
      const idempotencyKey = `POS_TRF_${cashierId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const transfer = await this.prisma.stockTransfer.create({
        data: {
          idempotencyKey,
          sourceWarehouseId: item.sourceWarehouseId,
          destWarehouseId: showroomId,
          status: 'REQUESTED',
          notes: dto.notes || `Transfer requested from POS for order ${dto.orderId || 'N/A'}`,
          performedBy: cashierId,
          requestedBy: cashierId,
          orderId: dto.orderId || null,
        },
      });

      transfers.push({
        id: transfer.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        sourceWarehouseId: item.sourceWarehouseId,
        status: 'REQUESTED',
      });
    }

    return { transfers, count: transfers.length };
  }
}
