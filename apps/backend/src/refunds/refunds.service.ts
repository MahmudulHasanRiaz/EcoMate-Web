import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { CodMismatchService } from '../cod-mismatch/cod-mismatch.service';

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
    // Shared COD alert recompute (Feature A). Optional so existing unit
    // tests that build RefundsService without it keep working.
    @Optional() private readonly codMismatch?: CodMismatchService,
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

  /**
   * Post-dispatch COD alert refresh (Feature A). Resilient — mirrors
   * invalidateAnalytics: an alert failure must never break the mutation.
   */
  private async refreshCodAlert(orderId: string): Promise<void> {
    try {
      await this.codMismatch?.recompute(orderId);
    } catch {
      /* alert failure must not fail refunds */
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

  async create(dto: CreateRefundDto, recordedBy?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      select: { id: true, total: true, kind: true, timeline: true },
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

    // D5 input gate: destination + reason up front, before any business-rule
    // check — a refund without a destination is an unauditable movement.
    if (!dto.method || !String(dto.method).trim()) {
      throw new BadRequestException(
        'Refund method is required — where the money went back (e.g. bkash, cash).',
      );
    }
    if (!dto.reason || !String(dto.reason).trim()) {
      throw new BadRequestException(
        'Refund reason is required — it is recorded on the ledger row.',
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

    // Gate rule (single source of truth — shared with the cancel gate in
    // orders.service): outstanding = netPaid − legacyRefunded, where netPaid
    // is Σ signed PAID payment rows (Task 5 negative corrections included)
    // and legacyRefunded is Σ approved/completed Refund rows with method
    // NULL (recorded before ledger mirroring). Every new-flow refund carries
    // method + a matching negative payment row, so counting new rows here
    // would double-count — they are counted via the ledger instead.
    const legacyAgg = await this.prisma.refund.aggregate({
      where: {
        orderId: dto.orderId,
        status: { in: ['approved', 'completed'] },
        method: null,
      },
      _sum: { amount: true },
    });
    const legacyRefunded = Number(legacyAgg._sum.amount || 0);
    const outstanding = paidAmount - legacyRefunded;
    if (dto.amount > outstanding) {
      throw new BadRequestException(
        `Refund amount (${dto.amount}) exceeds the amount actually paid less prior refunds (outstanding refundable: ${outstanding})`,
      );
    }

    // Atomic cancel-too requires FULL coverage: a partial refund would leave
    // outstanding > 0 and the cancel gate would still block afterwards, so
    // accepting it would promise an atomic cancel it cannot deliver.
    if (dto.cancelToo && dto.amount < outstanding) {
      throw new BadRequestException(
        `Refund with cancel requires a FULL refund: ${outstanding - dto.amount} would still be outstanding after this partial refund of ${dto.amount}. Refund the full outstanding balance to cancel atomically.`,
      );
    }

    await this.assertNoActiveDispatches(dto.orderId);

    // D-B: explicit source rows (payment-list selection). Validated BEFORE any
    // write — same order, PAID-only, per-row remainder cap. The requested total
    // is distributed across the rows in the given order (first row first); a
    // repeated refund of the same row 400s via the cap. The legacy single
    // `sourcePaymentId` (exchange flow) goes through the same validation.
    let allocations: { paymentId: string; amount: number }[] | undefined;
    const explicitIds = dto.sourcePaymentIds?.length
      ? [...new Set(dto.sourcePaymentIds)]
      : dto.sourcePaymentId
        ? [dto.sourcePaymentId]
        : undefined;
    if (explicitIds) {
      allocations = await this.resolveSourceAllocations(
        dto.orderId,
        dto.amount,
        explicitIds,
      );
    }

    // Traceability: pin the refund to the specific collection it reverses, so
    // the money can be followed back to the payment row rather than to an order
    // total. Oldest first, so partial refunds consume payments in order.
    let sourcePaymentId = dto.sourcePaymentId;
    if (!sourcePaymentId && !allocations) {
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

    // Single $transaction: Refund row(s) + negative ledger row(s) (+ optional
    // atomic Cancelled transition) commit together or not at all — a refund
    // must never exist without its ledger mirror, and vice versa. Every refund
    // also leaves a timeline entry (previously only cancelToo refunds did).
    const isBulk = !!allocations && allocations.length > 1;
    const refund = await this.prisma.$transaction(async (tx) => {
      const createdRefunds: any[] = [];
      const refundEntries: any[] = [];
      const at = new Date().toISOString();
      const actor = recordedBy ? `staff:${recordedBy}` : 'system';

      const writeRefundSlice = async (amount: number, pinId?: string) => {
        const created = await tx.refund.create({
          data: {
            orderId: dto.orderId,
            amount,
            method: dto.method,
            reason: dto.reason,
            notes: dto.notes,
            // Exchange-sourced refunds carry their lineage so the money is
            // traceable back to the exchange that produced it.
            ...(dto.exchangeOrderId ? { exchangeOrderId: dto.exchangeOrderId } : {}),
            ...(pinId ? { sourcePaymentId: pinId } : {}),
          },
          include: {
            order: { select: { displayId: true } },
            processor: { select: { id: true, firstName: true, lastName: true } },
          },
        });

        // Negative ledger mirror. PAID-direct (never PENDING): a refund is a
        // staff-verified money movement by construction — created through an
        // approve_payments-guarded endpoint — not a customer submission awaiting
        // verification. Routing it through PENDING would understate the ledger
        // (every reader sums Σ PAID) and strand the very refund that is
        // supposed to unblock cancellation.
        await tx.payment.create({
          data: {
            orderId: dto.orderId,
            gatewayCode: dto.method,
            amount: -amount,
            account: dto.method,
            status: 'PAID',
            notes: dto.reason,
            recordedBy: recordedBy ? `staff:${recordedBy}` : undefined,
            submittedBy: recordedBy ? `staff:${recordedBy}` : undefined,
            recordedAt: new Date(),
          },
        });

        refundEntries.push({
          type: 'refund',
          amount,
          method: dto.method,
          reason: dto.reason,
          ...(pinId ? { sourcePaymentId: pinId } : {}),
          timestamp: at,
          performedBy: actor,
        });
        createdRefunds.push(created);
      };

      if (allocations?.length) {
        for (const alloc of allocations) {
          await writeRefundSlice(alloc.amount, alloc.paymentId);
        }
      } else {
        await writeRefundSlice(dto.amount, sourcePaymentId);
      }

      const current = Array.isArray(order.timeline)
        ? [...(order.timeline as any[])]
        : [];

      // Atomic cancel-too: same tx moves the order to Cancelled (status
      // lookup by name, like cancelByCustomer) with timeline entries for
      // BOTH the refund(s) and the cancel. cancelToo=false refunds only.
      if (dto.cancelToo) {
        const cancelled = await tx.orderStatus.findFirst({
          where: { name: 'Cancelled' },
        });
        if (!cancelled) {
          throw new BadRequestException('Cancelled status not configured');
        }
        current.push(...refundEntries, {
          status: 'Cancelled',
          timestamp: at,
          note: `Cancelled atomically with refund (${dto.reason})`,
          performedBy: actor,
        });
        await tx.order.update({
          where: { id: dto.orderId },
          data: {
            statusId: cancelled.id,
            paymentStatus: 'REFUNDED',
            timeline: current as any,
          },
        });
      } else {
        current.push(...refundEntries);
        await tx.order.update({
          where: { id: dto.orderId },
          data: { timeline: current as any },
        });
      }

      return isBulk ? createdRefunds : createdRefunds[0];
    });

    if (dto.targetStatusId && !dto.cancelToo) {
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
    // Refund changes the outstanding collectable (Feature A, resilient).
    await this.refreshCodAlert(dto.orderId);
    return refund;
  }

  /**
   * D-B: validate explicit source rows and split the requested total across
   * them in the given order (first row first). 400s on unknown ids,
   * cross-order ids, non-PAID rows, or an over-remainder total. The per-row
   * remainder (row.amount − Σ non-rejected refunds by sourcePaymentId) also
   * makes a repeated refund of the same row a 400 — the remainder is already
   * consumed, so the cap rejects it (idempotent double-refund block).
   */
  private async resolveSourceAllocations(
    orderId: string,
    total: number,
    ids: string[],
  ): Promise<{ paymentId: string; amount: number }[]> {
    const rows = await this.prisma.payment.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderId: true, status: true, amount: true },
    });
    if (rows.length !== ids.length) {
      throw new BadRequestException(
        'One or more source payments were not found.',
      );
    }
    for (const row of rows) {
      if (row.orderId !== orderId) {
        throw new BadRequestException(
          'All source payments must belong to the same order.',
        );
      }
      if ((row.status as string) !== 'PAID') {
        throw new BadRequestException(
          'pending rows must be approved or failed first — only PAID payment rows can be refunded.',
        );
      }
    }
    const remainders = new Map<string, number>();
    let totalRemainder = 0;
    for (const row of rows) {
      const agg = await this.prisma.refund.aggregate({
        where: {
          sourcePaymentId: row.id,
          status: { in: ['pending', 'approved', 'completed'] },
        },
        _sum: { amount: true },
      });
      const remainder =
        Number(row.amount) - Number((agg._sum as any)?.amount || 0);
      remainders.set(row.id, remainder);
      totalRemainder += remainder;
    }
    if (total > totalRemainder) {
      throw new BadRequestException(
        `Refund amount (${total}) exceeds the remaining refundable amount for the selected payment rows (remainder: ${totalRemainder}).`,
      );
    }
    const allocations: { paymentId: string; amount: number }[] = [];
    let remaining = total;
    for (const id of ids) {
      if (remaining <= 0) break;
      const take = Math.min(remainders.get(id) ?? 0, remaining);
      if (take > 0) {
        allocations.push({ paymentId: id, amount: take });
        remaining -= take;
      }
    }
    return allocations;
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
