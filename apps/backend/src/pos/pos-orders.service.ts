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

  async create(dto: CreatePosOrderDto, sessionId: string, cashierId: string, idempotencyKey?: string) {
    const session = await this.prisma.posSession.findUnique({
      where: { id: sessionId },
      include: { showroom: true },
    });
    if (!session || session.status !== 'open') {
      throw new BadRequestException('No active POS session');
    }

    // Idempotency check: if key provided and already processed, return existing order
    if (idempotencyKey) {
      const existing = await this.prisma.order.findFirst({
        where: { idempotencyKey, trashedAt: null },
        include: { items: true, payments: true, customer: true },
      });
      if (existing) {
        this.logger.warn(`Idempotent request — returning existing order ${existing.displayId} (key: ${idempotencyKey})`);
        return existing;
      }
    }

    const displayId = await this.generateDisplayId();
    const { subtotal, total, discount } = this.recalculate(
      dto.items,
      dto.discount || 0,
      dto.discountType || 'flat',
    );

    const deliveryMethod = dto.deliveryMethod || 'Counter Sale';
    const isInstantDelivery = ['Counter Sale', 'Takeaway'].includes(
      deliveryMethod,
    );

    const statusName = isInstantDelivery ? 'delivered' : 'confirmed';
    const status = await this.prisma.orderStatus.findFirst({
      where: { name: { equals: statusName, mode: 'insensitive' } },
    });
    if (!status)
      throw new BadRequestException(
        `Status "${statusName}" not found. Please create an order status named "${isInstantDelivery ? 'Delivered' : 'Confirmed'}" in settings.`,
      );

    return this.prisma.$transaction(async (tx) => {
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
            { type: 'created', by: cashierId, at: new Date().toISOString() },
            { type: 'payment', status: 'PAID', at: new Date().toISOString() },
          ],
        },
      });

      for (const item of dto.items) {
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

      const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

      for (const item of dto.items) {
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
          const product = item.productId ? await tx.product.findUnique({
            where: { id: item.productId },
            select: { availabilityMode: true },
          }) : null;
          const decision = this.stockRouter.resolve(product?.availabilityMode, 'deduct', false);

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
