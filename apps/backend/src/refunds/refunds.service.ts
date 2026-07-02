import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { Prisma } from '@prisma/client';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['completed', 'rejected'],
  completed: [],
  rejected: [],
};

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async findAll(query: {
    page?: number;
    perPage?: number;
    status?: string;
    orderId?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const perPage = Math.max(1, Math.min(100, query.perPage || 10));
    const where: Prisma.RefundWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.orderId) where.orderId = query.orderId;

    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { displayId: true } },
          processor: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.refund.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        order: { select: { displayId: true } },
        processor: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
  }

  async create(dto: CreateRefundDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      select: { id: true, total: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (dto.amount > Number(order.total)) {
      throw new BadRequestException(
        `Refund amount (${dto.amount}) exceeds order total (${order.total})`,
      );
    }

    const existing = await this.prisma.refund.aggregate({
      where: { orderId: dto.orderId, status: 'completed' },
      _sum: { amount: true },
    });
    const refundedSoFar = Number(existing._sum.amount || 0);
    if (refundedSoFar + dto.amount > Number(order.total)) {
      throw new BadRequestException('Total refund would exceed order total');
    }

    return this.prisma.refund.create({
      data: {
        orderId: dto.orderId,
        amount: dto.amount,
        reason: dto.reason,
        notes: dto.notes,
      },
      include: {
        order: { select: { displayId: true } },
        processor: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateRefundStatusDto,
    processedBy: string,
    performedBy?: string,
  ) {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException('Refund not found');

    const allowed = VALID_TRANSITIONS[refund.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from "${refund.status}" to "${dto.status}". Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.refund.update({
        where: { id },
        data: {
          status: dto.status,
          processedBy,
          processedAt: new Date(),
          notes: dto.notes ?? refund.notes,
        },
        include: {
          order: { select: { id: true, displayId: true } },
          processor: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      if (dto.status === 'completed') {
        const [orderData, refundSum] = await Promise.all([
          tx.order.findUnique({
            where: { id: updated.order.id },
            select: { total: true },
          }),
          tx.refund.aggregate({
            where: { orderId: updated.order.id, status: 'completed' },
            _sum: { amount: true },
          }),
        ]);

        const totalRefunded = Number(refundSum._sum.amount || 0);
        const orderTotal = Number(orderData?.total || 0);

        await tx.order.update({
          where: { id: updated.order.id },
          data: {
            paymentStatus: totalRefunded >= orderTotal ? 'REFUNDED' : 'PAID',
          },
        });

        await this.inventoryService.restockOrderItems(
          updated.order.id,
          performedBy || processedBy,
          'refund_restock',
          false,
          tx,
        );
      }

      return updated;
    });
  }
}
