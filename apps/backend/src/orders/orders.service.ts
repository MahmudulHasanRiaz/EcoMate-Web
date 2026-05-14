import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';

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

  async findAll(query: { page?: number; perPage?: number; search?: string; statusId?: string; sort?: string; order?: string }) {
    const page = query.page || 1; const perPage = query.perPage || 10; const where: any = {};
    if (query.search) where.displayId = { contains: query.search, mode: 'insensitive' };
    if (query.statusId) where.statusId = query.statusId;
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where, skip: (page - 1) * perPage, take: perPage,
        orderBy: { [query.sort || 'createdAt']: query.order || 'desc' },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true } },
          status: true, items: { include: { product: { select: { id: true, name: true } } } },
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
        items: { include: { product: { select: { id: true, name: true, images: true } } } },
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

    const subtotal = dto.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const total = subtotal + (dto.shippingCharge || 0) - (dto.discount || 0);

    const order = await this.prisma.order.create({
      data: {
        displayId, customerId: dto.customerId, statusId: initialStatus.id,
        subtotal, shippingCharge: dto.shippingCharge || 0, discount: dto.discount || 0, total,
        shippingAddress: dto.shippingAddress as any, notes: dto.notes,
        items: { create: dto.items.map(i => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, price: i.price })) },
        timeline: [{ status: initialStatus.name, timestamp: new Date().toISOString(), note: 'Order created' }] as any,
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        status: true, items: { include: { product: { select: { id: true, name: true } } } },
      },
    });

    // Decrease stock
    for (const item of dto.items) {
      if (item.variantId) {
        await this.prisma.productVariant.update({ where: { id: item.variantId }, data: { stock: { decrement: item.quantity } } });
      }
    }

    return order;
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

    const timeline = [...((order.timeline as any[]) || []), { status: newStatus.name, timestamp: new Date().toISOString(), note: dto.notes || '' }];

    return this.prisma.order.update({
      where: { id },
      data: { statusId: dto.statusId, timeline: timeline as any },
      include: { status: true, customer: { select: { id: true, firstName: true, lastName: true } } },
    });
  }
}
