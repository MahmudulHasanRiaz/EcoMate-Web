import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto, UpdateOrderStatusDto, UpdateOrderDto, UpdateOrderItemDto } from './dto/order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private async generateDisplayId(): Promise<string> {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const prefix = `ORD-${yy}${mm}${dd}`;
    const last = await this.prisma.order.findFirst({ where: { displayId: { startsWith: prefix } }, orderBy: { displayId: 'desc' }, select: { displayId: true } });
    const nextNo = last ? parseInt(last.displayId.split('-').pop() || '0') + 1 : 1;
    return `${prefix}-${String(nextNo).padStart(4, '0')}`;
  }

  private recalculate(items: { price: number; quantity: number }[], shipping: number, discount: number) {
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    return { subtotal, total: Math.max(0, subtotal + shipping - discount) };
  }

  async findAll(query: { page?: number; perPage?: number; search?: string; statusId?: string; sort?: string; order?: string }) {
    const page = query.page || 1; const perPage = query.perPage || 10; const where: any = {};
    if (query.search) where.displayId = { contains: query.search, mode: 'insensitive' };
    if (query.statusId) where.statusId = query.statusId;
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where, skip: (page - 1) * perPage, take: perPage, orderBy: { [query.sort || 'createdAt']: query.order || 'desc' },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true } },
          status: true, items: { include: { product: { select: { id: true, name: true, images: true } } } },
          payments: true, shipment: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { data, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true } },
        status: true, shipment: true,
        items: { include: { product: { select: { id: true, name: true, images: true, slug: true } } } },
        payments: { include: { verifier: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async create(dto: CreateOrderDto) {
    const displayId = await this.generateDisplayId();
    const initialStatus = await this.prisma.orderStatus.findFirst({ where: { isInitial: true } });
    if (!initialStatus) throw new BadRequestException('No initial order status configured');

    const { subtotal, total } = this.recalculate(dto.items, dto.shippingCharge || 0, dto.discount || 0);

    const order = await this.prisma.order.create({
      data: {
        displayId, customerId: dto.customerId, statusId: initialStatus.id,
        subtotal, shippingCharge: dto.shippingCharge || 0, discount: dto.discount || 0,
        discountType: dto.discountType || 'flat', total,
        shippingAddress: dto.shippingAddress as any,
        customerNotes: dto.customerNotes, officeNotes: dto.officeNotes,
        items: { create: dto.items.map(i => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, price: i.price })) },
        timeline: [{ status: initialStatus.name, timestamp: new Date().toISOString(), note: 'Order created' }] as any,
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        status: true, items: { include: { product: { select: { id: true, name: true, images: true } } } },
      },
    });

    for (const item of dto.items) {
      await this.prisma.inventoryLog.create({
        data: { productId: item.productId, variantId: item.variantId, quantity: -item.quantity, type: 'order_placed', reason: `Order ${displayId}`, createdAt: new Date() },
      });
      if (item.variantId) {
        await this.prisma.productVariant.update({ where: { id: item.variantId }, data: { stock: { decrement: item.quantity } } });
      }
    }

    return order;
  }

  async updateOrder(id: string, dto: UpdateOrderDto) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: { include: { product: { select: { id: true, name: true } } } } } });
    if (!order) throw new NotFoundException('Order not found');

    const timeline = [...((order.timeline as any[]) || [])];
    const now = new Date().toISOString();

    if (dto.shippingCharge !== undefined && Number(dto.shippingCharge) !== Number(order.shippingCharge)) {
      timeline.push({ type: 'shipping', visibility: 'public', timestamp: now, oldValue: Number(order.shippingCharge), newValue: Number(dto.shippingCharge), note: `Shipping: ৳${Number(order.shippingCharge)} → ৳${Number(dto.shippingCharge)}` });
    }

    if (dto.discount !== undefined && Number(dto.discount) !== Number(order.discount)) {
      timeline.push({ type: 'discount', visibility: 'public', timestamp: now, oldValue: Number(order.discount), newValue: Number(dto.discount), discountType: dto.discountType || order.discountType, note: `Discount changed to ৳${Number(dto.discount)} (${dto.discountType || order.discountType})` });
    }

    if (dto.items && dto.items.length > 0) {
      await this.prisma.orderItem.deleteMany({ where: { orderId: id } });
      await this.prisma.orderItem.createMany({
        data: dto.items.map(i => ({ orderId: id, productId: i.productId, variantId: i.variantId, quantity: i.quantity, price: i.price })),
      });
      const oldItems = order.items.map(i => `${i.product.name} ×${i.quantity}`).join(', ');
      const newItems = dto.items.map(i => `${i.productId} ×${i.quantity}`).join(', '); // will resolve below
      timeline.push({ type: 'items', visibility: 'public', timestamp: now, note: 'Order items updated' });
    }

    const data: any = {};
    data.timeline = timeline;
    if (dto.shippingCharge !== undefined) data.shippingCharge = dto.shippingCharge;
    if (dto.discount !== undefined) data.discount = dto.discount;
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.customerNotes !== undefined) data.customerNotes = dto.customerNotes;
    if (dto.officeNotes !== undefined) data.officeNotes = dto.officeNotes;
    if (dto.shippingAddress !== undefined) data.shippingAddress = dto.shippingAddress as any;

    const currentItems = dto.items && dto.items.length > 0 ? dto.items : order.items.map(i => ({ price: Number(i.price), quantity: i.quantity }));
    const shipping = data.shippingCharge !== undefined ? data.shippingCharge : Number(order.shippingCharge);
    const discount = data.discount !== undefined ? data.discount : Number(order.discount);
    const { subtotal, total } = this.recalculate(currentItems as any[], shipping, discount);
    data.subtotal = subtotal;
    data.total = total;

    return this.prisma.order.update({
      where: { id }, data,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true } },
        status: true, shipment: true,
        items: { include: { product: { select: { id: true, name: true, images: true, slug: true } } } },
        payments: true,
      },
    });
  }

  async addNote(orderId: string, note: string, visibility: 'public' | 'private', userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const timeline = [...((order.timeline as any[]) || []), {
      type: 'note',
      visibility,
      timestamp: new Date().toISOString(),
      note,
      addedBy: userId,
    }];

    return this.prisma.order.update({
      where: { id: orderId }, data: { timeline: timeline as any },
      include: { status: true, customer: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { status: true } });
    if (!order) throw new NotFoundException('Order not found');

    const newStatus = await this.prisma.orderStatus.findUnique({ where: { id: dto.statusId } });
    if (!newStatus) throw new NotFoundException('Status not found');

    const allowedIds = (order.status.nextStatuses as string[]) || [];
    if (!allowedIds.includes(dto.statusId)) {
      throw new BadRequestException(`Cannot transition from "${order.status.name}" to "${newStatus.name}"`);
    }

    const timeline = [...((order.timeline as any[]) || []), {
      status: newStatus.name,
      timestamp: new Date().toISOString(),
      note: dto.note || '',
      changedBy: userId,
    }];

    return this.prisma.order.update({
      where: { id },
      data: { statusId: dto.statusId, timeline: timeline as any },
      include: { status: true, customer: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async addItem(orderId: string, dto: UpdateOrderItemDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');

    await this.prisma.orderItem.create({
      data: { orderId, productId: dto.productId, variantId: dto.variantId, quantity: dto.quantity, price: dto.price },
    });

    const items = [...order.items.map(i => ({ price: Number(i.price), quantity: i.quantity })), { price: dto.price, quantity: dto.quantity }];
    const { subtotal, total } = this.recalculate(items, Number(order.shippingCharge), Number(order.discount));
    return this.prisma.order.update({ where: { id: orderId }, data: { subtotal, total }, include: { items: { include: { product: { select: { id: true, name: true, images: true, slug: true } } } } } });
  }

  async removeItem(orderId: string, itemId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    await this.prisma.orderItem.delete({ where: { id: itemId } });

    const remaining = order.items.filter(i => i.id !== itemId).map(i => ({ price: Number(i.price), quantity: i.quantity }));
    const { subtotal, total } = this.recalculate(remaining, Number(order.shippingCharge), Number(order.discount));
    return this.prisma.order.update({ where: { id: orderId }, data: { subtotal, total }, include: { items: { include: { product: { select: { id: true, name: true, images: true, slug: true } } } } } });
  }
}
