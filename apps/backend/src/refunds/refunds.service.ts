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

    const refund = await this.prisma.refund.create({
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

    if (dto.targetStatusId) {
      const targetStatus = await this.prisma.orderStatus.findUnique({
        where: { id: dto.targetStatusId },
      });
      if (!targetStatus) throw new BadRequestException('Invalid target status');

      const isPreShippingTarget = ['Cancelled', 'Hold'].includes(
        targetStatus.name,
      );

      if (isPreShippingTarget) {
        const activeDispatchCount = await this.prisma.dispatch.count({
          where: {
            orderId: dto.orderId,
            status: {
              in: ['HANDED_OVER', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'],
            },
          },
        });

        const order = await this.prisma.order.findUnique({
          where: { id: dto.orderId },
          include: { status: true },
        });

        if (activeDispatchCount > 0 || order?.status?.name === 'Shipping') {
          throw new BadRequestException(
            `Cannot set status to "${targetStatus.name}" — order is already in courier pipeline. Select "Return Pending" or "Returned" instead.`,
          );
        }
      }

      const allRefunds = await this.prisma.refund.findMany({
        where: {
          orderId: dto.orderId,
          status: { in: ['completed', 'approved'] },
        },
        select: { amount: true },
      });
      const totalRefunded = allRefunds.reduce(
        (sum, r) => sum + Number(r.amount),
        0,
      );
      const isFullRefund = totalRefunded >= Number(order.total);

      await this.prisma.order.update({
        where: { id: dto.orderId },
        data: {
          statusId: dto.targetStatusId,
          paymentStatus: isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUNDED',
        },
      });
    }

    return refund;
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
            paymentStatus: totalRefunded >= orderTotal ? 'REFUNDED' : 'PARTIAL_REFUNDED',
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
