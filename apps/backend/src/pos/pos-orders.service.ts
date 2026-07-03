import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';
import { HoldCartDto } from './dto/hold-cart.dto';

@Injectable()
export class PosOrdersService {
  private readonly logger = new Logger(PosOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

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
    items: { price: number; quantity: number; discount?: number; discountType?: string }[],
    orderDiscount: number,
    orderDiscountType: string,
  ) {
    let subtotal = 0;
    let totalItemDiscount = 0;

    for (const item of items) {
      const lineTotal = item.price * item.quantity;
      subtotal += lineTotal;
      if (item.discount) {
        totalItemDiscount += item.discountType === 'percentage'
          ? (lineTotal * item.discount) / 100
          : item.discount;
      }
    }

    const afterItemDiscount = subtotal - totalItemDiscount;
    let orderDiscountVal = 0;
    if (orderDiscount) {
      orderDiscountVal = orderDiscountType === 'percentage'
        ? (afterItemDiscount * orderDiscount) / 100
        : orderDiscount;
    }

    const total = subtotal - totalItemDiscount - orderDiscountVal;
    return { subtotal, total, discount: totalItemDiscount + orderDiscountVal };
  }

  private async getDescendantCategoryIds(categoryId: string): Promise<string[]> {
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
    return this.prisma.user.findFirst({
      where: { phoneNumber: phone, role: 'customer' },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    });
  }

  async quickCreateCustomer(phone: string, name?: string) {
    const existing = await this.prisma.user.findFirst({
      where: { phoneNumber: phone, role: 'customer' },
    });
    if (existing) return existing;

    return this.prisma.user.create({
      data: {
        firstName: name || phone,
        lastName: '',
        username: `cust_${phone.replace(/[^0-9]/g, '')}`,
        email: `${phone.replace(/[^0-9]/g, '')}@pos.ecomate`,
        phoneNumber: phone,
        password: '',
        role: 'customer',
        status: 'active',
      },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    });
  }

  async create(dto: CreatePosOrderDto, sessionId: string, cashierId: string) {
    const session = await this.prisma.posSession.findUnique({
      where: { id: sessionId },
      include: { showroom: true },
    });
    if (!session || session.status !== 'open') {
      throw new BadRequestException('No active POS session');
    }

    const displayId = await this.generateDisplayId();
    const { subtotal, total, discount } = this.recalculate(
      dto.items,
      dto.discount || 0,
      dto.discountType || 'flat',
    );

    const deliveryMethod = dto.deliveryMethod || 'Counter Sale';
    const isInstantDelivery = ['Counter Sale', 'Takeaway'].includes(deliveryMethod);

    const status = await this.prisma.orderStatus.findFirst({
      where: { name: isInstantDelivery ? 'delivered' : 'confirmed' },
    });
    if (!status) throw new BadRequestException(`Status "${isInstantDelivery ? 'delivered' : 'confirmed'}" not found`);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          displayId,
          statusId: status.id,
          subtotal,
          shippingCharge: 0,
          discount,
          discountType: dto.discountType || 'flat',
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

      for (const item of dto.items) {
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

      return tx.order.findUnique({
        where: { id: order.id },
        include: { items: true, payments: true, customer: true },
      });
    });
  }

  async findProducts(query: { search?: string; categoryId?: string; barcode?: string; page?: number; perPage?: number }) {
    const where: any = { isActive: true };

    if (query.barcode) {
      where.sku = query.barcode;
    } else if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.categoryId) {
      const descendantIds = await this.getDescendantCategoryIds(query.categoryId);
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
          variants: { where: { isActive: true }, take: 5 },

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
