import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

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
    @Optional() private readonly cache?: CacheService,
  ) {}

  /**
   * Business analytics freshness (P2 §6): refunds feed the reversal line,
   * the informational total and settlement. No-op without cache; resilient.
   */
  private async invalidateAnalytics(): Promise<void> {
    try {
      await this.cache?.invalidateByPrefix('analytics:');
    } catch {
      /* cache failure must not fail refunds */
    }
  }

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
      select: { id: true, total: true, kind: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Refunds return MONEY, so the ceiling is what was actually collected —
    // not what the order was worth. A COD order that was never paid, or a
    // return/exchange row that carries no collection of its own, has nothing to
    // give back; capping at `total` (the previous behaviour) let both through
    // and wrote a revenue reversal with no matching collection.
    // A missing kind is treated as SALE: every row created before the column
    // existed is a normal sale, and defaulting to non-sale would make legacy
    // orders un-refundable.
    if ((order.kind ?? 'SALE') !== 'SALE') {
      throw new BadRequestException(
        'Refunds can only be issued against a sale order. This order is a ' +
          `${order.kind} transaction — reverse it through its own return/exchange flow.`,
      );
    }

    const paidAgg = await this.prisma.payment.aggregate({
      where: { orderId: dto.orderId, status: 'PAID' },
      _sum: { amount: true },
    });
    const paidAmount = Number(paidAgg._sum.amount || 0);
    if (paidAmount <= 0) {
      throw new BadRequestException(
        'This order has no completed payment, so there is nothing to refund.',
      );
    }

    if (dto.amount > paidAmount) {
      throw new BadRequestException(
        `Refund amount (${dto.amount}) exceeds the amount actually paid (${paidAmount})`,
      );
    }

    const existing = await this.prisma.refund.aggregate({
      where: { orderId: dto.orderId, status: 'completed' },
      _sum: { amount: true },
    });
    const refundedSoFar = Number(existing._sum.amount || 0);
    if (refundedSoFar + dto.amount > paidAmount) {
      throw new BadRequestException(
        `Total refund would exceed the amount actually paid (${paidAmount})`,
      );
    }

    await this.assertNoActiveDispatches(dto.orderId);

    // Traceability: pin the refund to the specific collection it reverses, so
    // the money can be followed back to the payment row rather than to an order
    // total. Oldest first, so partial refunds consume payments in order.
    let sourcePaymentId = dto.sourcePaymentId;
    if (!sourcePaymentId) {
      const alreadyRefundedPayments = await this.prisma.refund.findMany({
        where: { orderId: dto.orderId, status: 'completed', sourcePaymentId: { not: null } },
        select: { sourcePaymentId: true },
      });
      const consumed = new Set(alreadyRefundedPayments.map((r) => r.sourcePaymentId));
      const candidate = await this.prisma.payment.findFirst({
        where: { orderId: dto.orderId, status: 'PAID' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      sourcePaymentId = candidate && !consumed.has(candidate.id) ? candidate.id : undefined;
    }

    const refund = await this.prisma.refund.create({
      data: {
        orderId: dto.orderId,
        amount: dto.amount,
        reason: dto.reason,
        notes: dto.notes,
        // Exchange-sourced refunds carry their lineage so the money is
        // traceable back to the exchange that produced it.
        ...(dto.exchangeOrderId ? { exchangeOrderId: dto.exchangeOrderId } : {}),
        ...(sourcePaymentId ? { sourcePaymentId } : {}),
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

    await this.invalidateAnalytics();
    return refund;
  }

  private async assertNoActiveDispatches(orderId: string): Promise<void> {
    const activeDispatch = await this.prisma.dispatch.findFirst({
      where: { orderId, status: { not: 'CANCELLED' } },
    });
    if (activeDispatch) {
      throw new BadRequestException(
        `Cannot process refund while order has active dispatch (${activeDispatch.status}). Please cancel the dispatch first.`,
      );
    }
  }

  async updateStatus(
    id: string,
    dto: UpdateRefundStatusDto,
    processedBy: string,
    performedBy?: string,
  ) {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException('Refund not found');

    if (dto.status === 'completed') {
      await this.assertNoActiveDispatches(refund.orderId);
    }

    const allowed = VALID_TRANSITIONS[refund.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from "${refund.status}" to "${dto.status}". Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
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
            paymentStatus:
              totalRefunded >= orderTotal ? 'REFUNDED' : 'PARTIAL_REFUNDED',
          },
        });
      }

      return updated;
    });
    await this.invalidateAnalytics();
    return updated;
  }
}
