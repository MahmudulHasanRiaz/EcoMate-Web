import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { CodMismatchService } from '../cod-mismatch/cod-mismatch.service';
import {
  DispatchCancelService,
  type DispatchCancelPlan,
} from '../dispatch-cancel/dispatch-cancel.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';

import { Prisma } from '@prisma/client';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';
import {
  requireConfiguredGateway,
  resolvePaymentAccountId,
} from '../payments/payment-account';
import { PaymentJournalService } from '../accounting/payment-journal.service';

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
    // The shared order-cancel release routine (StockModule is @Global). The
    // atomic cancel-with-refund MUST release managed + physical reservations
    // exactly like the plain cancel path; it previously missed this entirely.
    private readonly cancelReturnStock: CancelReturnStockService,
    @Optional() private readonly cache?: CacheService,
    // Shared COD alert recompute (Feature A). Optional so existing unit
    // tests that build RefundsService without it keep working.
    @Optional() private readonly codMismatch?: CodMismatchService,
    // Cancel a DISPATCHED order with its dispatch (owner directive
    // 2026-10-21). Optional for the same reason (unit tests build
    // RefundsService without it) — production always wires it: RefundsModule
    // imports DispatchCancelModule.
    @Optional() private readonly dispatchCancel?: DispatchCancelService,
    // Phase 2 — auto-journal for recorded refunds (the mirror of the original
    // receipt). Optional so existing unit tests keep working.
    @Optional() private readonly paymentJournal?: PaymentJournalService,
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

    // Part 4: refunds are staff writes — the destination gateway must exist in
    // configuration (legacy callers may only send `method`, which is then the
    // code). The mapped account is stamped unless an eligible one is supplied.
    const refundGatewayCode = dto.gatewayCode || dto.method;
    const refundGateway = await requireConfiguredGateway(
      this.prisma,
      refundGatewayCode,
    );
    const refundAccountId = await resolvePaymentAccountId(this.prisma, {
      accountId: dto.accountId,
      gatewayAccountId: refundGateway?.accountId,
    });

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

    // A cancel-with-refund cancels the dispatch WITH ITS COURIER first (the
    // eligibility check + the courier push run BEFORE the transaction; the
    // dispatch rows flip inside it). A courier failure aborts everything —
    // the order, the refund and the dispatch stay exactly as they were.
    // A plain refund (no cancel) keeps the old rule: never touch a dispatched
    // order without cancelling its booking.
    let dispatchPlan: DispatchCancelPlan | null = null;
    if (dto.cancelToo && this.dispatchCancel) {
      dispatchPlan = await this.dispatchCancel.prepare(dto.orderId, recordedBy);
    } else {
      await this.assertNoActiveDispatches(dto.orderId);
    }

    // D-B: explicit source rows (payment-list selection). Validated BEFORE any
    // write — same order, PAID-only, per-row remainder cap. The requested total
    // is distributed across the rows in the given order (first row first); a
    // repeated refund of the same row 400s via the cap. The legacy single
    // `sourcePaymentId` (exchange flow) goes through the same validation.
    let allocations:
      | {
          paymentId: string;
          amount: number;
          gatewayCode?: string | null;
          accountId?: string | null;
          account?: string | null;
        }[]
      | undefined;
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

    // Owner spec 2026-10-30: a refund slice pinned to a source payment goes
    // back through THAT payment's channel and account — the negative ledger
    // row carries the source row's gateway + settlement account, never a
    // staff-typed substitute. The unpinned single slice resolves its source
    // the same way (the traceability pin above). Fail-soft: if the lookup
    // is unavailable the slice keeps the call-level resolution, exactly as
    // before this change.
    const singleSource =
      !allocations &&
      sourcePaymentId &&
      typeof this.prisma.payment.findUnique === 'function'
        ? await this.prisma.payment.findUnique({
            where: { id: sourcePaymentId },
            select: { gatewayCode: true, accountId: true, account: true },
          })
        : null;

    // Single $transaction: Refund row(s) + negative ledger row(s) (+ optional
    // atomic Cancelled transition) commit together or not at all — a refund
    // must never exist without its ledger mirror, and vice versa. Every refund
    // also leaves a timeline entry (previously only cancelToo refunds did).
    const isBulk = !!allocations && allocations.length > 1;
    // Phase 2: the mirror of each refund's original receipt is posted AFTER
    // this transaction commits (never inside it — the journal service owns its
    // own entry transaction). Collected here so bulk allocations each get their
    // own mirror on their own source row.
    const refundMirrors: {
      paymentId: string;
      sourcePaymentId: string | null;
    }[] = [];
    const refund = await this.prisma.$transaction(async (tx) => {
      const createdRefunds: any[] = [];
      const refundEntries: any[] = [];
      const at = new Date().toISOString();
      const actor = recordedBy ? `staff:${recordedBy}` : 'system';

      const writeRefundSlice = async (
        amount: number,
        pinId?: string,
        source?: {
          gatewayCode?: string | null;
          accountId?: string | null;
          account?: string | null;
        } | null,
      ) => {
        // Per-slice channel/account (owner spec 2026-10-30): a pinned slice
        // refunds through its source payment's gateway + account; only an
        // unpinned slice falls back to the call-level resolution.
        const sliceGatewayCode = source?.gatewayCode || refundGatewayCode;
        const sliceAccountId = source?.accountId ?? refundAccountId;
        const sliceMethod = source?.account || dto.method;
        const created = await tx.refund.create({
          data: {
            orderId: dto.orderId,
            amount,
            method: sliceMethod,
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
        const refundPayment = await tx.payment.create({
          data: {
            orderId: dto.orderId,
            gatewayCode: sliceGatewayCode,
            amount: -amount,
            accountId: sliceAccountId,
            account: sliceMethod,
            status: 'PAID',
            notes: dto.reason,
            recordedBy: recordedBy ? `staff:${recordedBy}` : undefined,
            submittedBy: recordedBy ? `staff:${recordedBy}` : undefined,
            recordedAt: new Date(),
          },
        });
        refundMirrors.push({
          paymentId: refundPayment.id,
          sourcePaymentId: pinId ?? null,
        });

        refundEntries.push({
          type: 'refund',
          amount,
          method: sliceMethod,
          reason: dto.reason,
          ...(pinId ? { sourcePaymentId: pinId } : {}),
          timestamp: at,
          performedBy: actor,
        });
        createdRefunds.push(created);
      };

      if (allocations?.length) {
        for (const alloc of allocations) {
          await writeRefundSlice(alloc.amount, alloc.paymentId, alloc);
        }
      } else {
        await writeRefundSlice(dto.amount, sourcePaymentId, singleSource);
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
        // Shared cancellation release — same routine as the plain cancel
        // path. Inside the SAME transaction: an order can never commit as
        // Cancelled while its managed/physical reservation stays held.
        // Idempotent, so a client retry cannot release twice.
        await this.cancelReturnStock.releaseForCancellation({
          orderId: dto.orderId,
          performedBy: recordedBy,
          tx,
        });
        // The dispatch is cancelled with the courier in the SAME transaction
        // as the refund + the order cancel (the courier push already
        // succeeded above). After the order write: that write REPLACES the
        // timeline column, so the audit entry is appended last.
        if (dispatchPlan) {
          await this.dispatchCancel!.apply(tx, dispatchPlan, recordedBy);
        }
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

      // A target status of Cancelled is another order-cancel entry point:
      // the status write and the shared managed+physical release must commit
      // atomically, exactly like cancelToo.
      if (targetStatus.name === 'Cancelled') {
        await this.prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: dto.orderId },
            data: {
              statusId: dto.targetStatusId,
              paymentStatus: isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUNDED',
            },
          });
          await this.cancelReturnStock.releaseForCancellation({
            orderId: dto.orderId,
            performedBy: recordedBy,
            tx,
          });
        });
      } else {
        await this.prisma.order.update({
          where: { id: dto.orderId },
          data: {
            statusId: dto.targetStatusId,
            paymentStatus: isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUNDED',
          },
        });
      }
    }

    await this.invalidateAnalytics();
    // Refund changes the outstanding collectable (Feature A, resilient).
    await this.refreshCodAlert(dto.orderId);
    // Phase 2: post each refund's journal — the mirror image of the original
    // receipt, on the original's contra account (see PaymentJournalService).
    for (const mirror of refundMirrors) {
      await this.paymentJournal?.tryPostRefundMirror(
        mirror.paymentId,
        mirror.sourcePaymentId,
      );
    }
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
  ): Promise<
    {
      paymentId: string;
      amount: number;
      gatewayCode?: string | null;
      accountId?: string | null;
      account?: string | null;
    }[]
  > {
    const rows = await this.prisma.payment.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        orderId: true,
        status: true,
        amount: true,
        gatewayCode: true,
        accountId: true,
        account: true,
      },
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
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const allocations: {
      paymentId: string;
      amount: number;
      gatewayCode?: string | null;
      accountId?: string | null;
      account?: string | null;
    }[] = [];
    let remaining = total;
    for (const id of ids) {
      if (remaining <= 0) break;
      const take = Math.min(remainders.get(id) ?? 0, remaining);
      if (take > 0) {
        const src = rowById.get(id);
        allocations.push({
          paymentId: id,
          amount: take,
          gatewayCode: src?.gatewayCode,
          accountId: src?.accountId,
          account: src?.account,
        });
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
