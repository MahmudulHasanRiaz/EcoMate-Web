import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface ShipmentQuery {
  page?: number;
  perPage?: number;
  search?: string;
  courier?: string;
  status?: string;
}

interface CreateOrUpdateShipmentDto {
  trackingNo?: string;
  courier?: string;
  status?: string;
}

const orderInclude = {
  customer: { select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true } },
  items: { include: { product: { select: { id: true, name: true, images: true } } } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class ShipmentService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ShipmentQuery) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: Prisma.ShipmentWhereInput = {};

    if (query.search) {
      where.OR = [
        { trackingNo: { contains: query.search, mode: 'insensitive' } },
        { orderId: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.courier) where.courier = { contains: query.courier, mode: 'insensitive' };
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { order: { include: orderInclude } },
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return { data, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } };
  }

  async findByOrderId(orderId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { orderId },
      include: { order: { include: orderInclude } },
    });
    if (!shipment) throw new NotFoundException('Shipment not found for this order');
    return shipment;
  }

  async createOrUpdate(orderId: string, dto: CreateOrUpdateShipmentDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    return this.prisma.shipment.upsert({
      where: { orderId },
      update: dto,
      create: { orderId, ...dto },
      include: { order: { include: orderInclude } },
    });
  }
}
