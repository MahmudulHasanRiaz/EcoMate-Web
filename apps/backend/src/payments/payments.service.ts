import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus } from '@prisma/client';
import { CreatePaymentDto, VerifyPaymentDto } from '../orders/dto/order.dto';
import { CacheService } from '../cache/cache.service';
import { CodMismatchService } from '../cod-mismatch/cod-mismatch.service';
import { CustomerCreditService } from '../customer-credit/customer-credit.service';
import {
  PaymentSettings,
  parsePaymentSettings,
  readPaymentSettings,
} from './payment-settings';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: CacheService,
    // Shared COD alert recompute (Feature A). Optional so existing unit
    // tests that build PaymentsService without it keep working.
    @Optional() private readonly codMismatch?: CodMismatchService,
    // Task 8 — marginal overpay grant. Optional for the same reason; the
    // grant call below is skipped when no credit service is wired.
    @Optional() private readonly credit?: CustomerCreditService,
  ) {}

  /**
   * Post-dispatch COD alert refresh. Resilient — mirrors invalidateAnalytics:
   * an alert failure must never break the payment mutation.
   */
  private async refreshCodAlert(orderId: string): Promise<void> {
    try {
      await this.codMismatch?.recompute(orderId);
    } catch {
      /* alert failure must not fail payments */
    }
  }

  /**
   * Business analytics freshness (P2 §6): payment rows feed L3 cash and the
   * gateway-fee line, so every payment mutation drops `analytics:*` eagerly.
   * No-op when no cache is wired. Resilient — never breaks the mutation.
   */
  private async invalidateAnalytics(): Promise<void> {
    try {
      await this.cache?.invalidateByPrefix('analytics:');
    } catch {
      /* cache failure must not fail payments */
    }
  }

  async findAll(query: {
    page?: number;
    perPage?: number;
    gatewayCode?: string;
    status?: string;
    orderId?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: any = {};
    if (query.gatewayCode) where.gatewayCode = query.gatewayCode;
    if (query.status) where.status = query.status;
    if (query.orderId) where.orderId = query.orderId;
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { displayId: true } },
          verifier: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async getPaymentSettings(): Promise<PaymentSettings> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: ['payments.staffAutoVerified', 'payments.editAllowed'] } },
    });
    return parsePaymentSettings(rows ?? []);
  }

  async create(
    orderId: string,
    dto: CreatePaymentDto,
    opts?: { userId?: string; token?: string; isStaff?: boolean },
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the order row first — prevents concurrent payment insert races
      await tx.$queryRawUnsafe(
        'SELECT id FROM "Order" WHERE id = $1 FOR UPDATE',
        orderId,
      );

      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { payments: true },
      });

      // Staff acting on any order are exempt from the ownership gate (the
      // exemption is context-bound to an authenticated staff actor, mirroring
      // the Q3 order-create exemption). Customers/guests keep the gate as-is.
      const isStaff = !!opts?.isStaff;
      const ownsOrder = opts?.userId && order.customerId === opts.userId;
      const hasValidToken = opts?.token && order.viewToken === opts.token;
      if (!isStaff && !ownsOrder && !hasValidToken) {
        throw new NotFoundException('Order not found');
      }

      // Append-only ledger: zero is never a payment; negatives are
      // corrections/refunds and must carry a reason (never silent).
      const paymentAmount = Number(dto.amount);
      if (isNaN(paymentAmount) || paymentAmount === 0) {
        throw new BadRequestException(
          'Payment amount must be a non-zero number',
        );
      }
      if (paymentAmount < 0 && !(dto.notes && dto.notes.trim())) {
        throw new BadRequestException(
          'Reason (notes) is required for correction/refund entries',
        );
      }

      // Overpayment is ALLOWED (append-only ledger; Task 8 grants the excess
      // as customer credit). No remaining-balance throw here.

      if (
        order.paymentOptionType === 'PARTIAL_PAYMENT' &&
        order.partialAmount &&
        order.payments.length === 0
      ) {
        const requiredPartial = Number(order.partialAmount);
        if (paymentAmount < requiredPartial) {
          throw new BadRequestException(
            `Initial payment for partial payment order must be at least ৳${requiredPartial}`,
          );
        }
      }

      // S1/S2 settings (seeded in prisma/seed.ts; code defaults match).
      const settings = await readPaymentSettings(tx);

      // Manual gateway detection: look up by code; unknown codes are treated
      // as manual (safe — forces account + verification instead of silent
      // auto-verify). Optional-chained so unit-test tx doubles without a
      // paymentGateway delegate still resolve (as unknown → manual).
      let gateway: { type?: string } | null = null;
      try {
        gateway =
          (await (tx as any).paymentGateway?.findUnique?.({
            where: { code: dto.gatewayCode },
          })) ?? null;
      } catch {
        gateway = null;
      }
      const isManual = !gateway || gateway.type === 'manual';

      if (isManual && !(dto.account && dto.account.trim())) {
        throw new BadRequestException(
          'Account is required for manual gateway payments',
        );
      }

      // Staff entries skip the verification queue when S1 is ON (PAID
      // directly + verifiedBy/At). Everything else stays PENDING; the live
      // API-callback path (non-manual type) stays auto-verified as before.
      const autoVerified = isStaff && settings.staffAutoVerified;
      const status = isManual
        ? autoVerified
          ? PaymentStatus.PAID
          : PaymentStatus.PENDING
        : PaymentStatus.PAID;

      // txnId is required exactly when the entry will sit PENDING
      // (customer-submitted always; staff when S1 OFF), optional otherwise.
      if (
        status === PaymentStatus.PENDING &&
        !(dto.transactionId && dto.transactionId.trim())
      ) {
        throw new BadRequestException(
          'Transaction ID is required for payments awaiting verification',
        );
      }

      const created = await tx.payment.create({
        data: {
          orderId,
          gatewayCode: dto.gatewayCode,
          amount: dto.amount,
          account: dto.account,
          transactionId: dto.transactionId,
          screenshot: dto.screenshot,
          notes: dto.notes,
          status,
          ...(autoVerified && opts?.userId
            ? { verifiedBy: opts.userId, verifiedAt: new Date() }
            : {}),
          recordedBy:
            isStaff && opts?.userId ? `staff:${opts.userId}` : null,
          submittedBy:
            isStaff && opts?.userId
              ? `staff:${opts.userId}`
              : order.customerId
                ? `customer:${order.customerId}`
                : null,
          // D4: server-set, always. Any client-sent recordedAt is ignored
          // (never read — the DTO does not even declare the field).
          recordedAt: new Date(),
        },
      });

      // Task 8 — marginal overpay grant, SAME $transaction (atomic with the
      // payment row). paidBefore counts PAID rows only, matching the shared
      // recompute's coverage (Σ PAID amount + Σ appliedCreditAmount); the
      // service grants excessAfter − excessBefore so each payment grants only
      // its own marginal overpay. Guest orders (no customerId) never grant.
      // The grant does NOT change paidTotal, so the recompute below (which
      // fires once, after commit) needs no second call here.
      if (order.customerId && this.credit) {
        const paidBefore = (order.payments ?? [])
          .filter((p: any) => p.status === PaymentStatus.PAID)
          .reduce((s: number, p: any) => s + Number(p.amount), 0);
        await this.credit.grantFromOverpayment(tx, {
          customerId: order.customerId,
          orderId,
          paymentId: created.id,
          orderTotal: Number(order.total),
          paidBefore,
          newAmount: paymentAmount,
          isPaid: created.status === PaymentStatus.PAID,
        });
      }

      return created;
    });
    await this.invalidateAnalytics();
    await this.refreshCodAlert(orderId);
    return created;
  }

  async verify(id: string, dto: VerifyPaymentDto, userId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundException('Payment not found');

      // Self-approve block (Task 6): recordedBy is `staff:<userId>` for
      // staff entries (null for customer-submitted), verifiedBy is the raw
      // userId — same id space, so a direct comparison is exact.
      if (payment.recordedBy === `staff:${userId}`) {
        throw new ForbiddenException('Staff cannot approve their own entry');
      }

      // Lock the order row — prevents concurrent verify races on order status
      await tx.$queryRawUnsafe(
        'SELECT id FROM "Order" WHERE id = $1 FOR UPDATE',
        payment.orderId,
      );

      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: dto.status,
          verifiedBy: userId,
          verifiedAt: new Date(),
          notes: dto.notes ?? payment.notes,
          // Analytics cost capture (P2 §3.2): gateway fee for THIS payment
          // row. P&L counts it only while the row is PAID, so PAID→FAILED
          // drops it structurally (F3-safe).
          ...(dto.feeAmount !== undefined ? { feeAmount: dto.feeAmount } : {}),
        },
      });

      // Always recalculate order payment status (handles PAID→FAILED rollback too)
      const paidAgg = await tx.payment.aggregate({
        where: { orderId: payment.orderId, status: PaymentStatus.PAID },
        _sum: { amount: true },
      });
      const totalPaid = Number(paidAgg._sum.amount || 0);
      const orderData = await tx.order.findUnique({
        where: { id: payment.orderId },
        select: { total: true },
      });
      const orderTotal = Number(orderData?.total || 0);

      if (totalPaid === 0) {
        await tx.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: PaymentStatus.PAYMENT_PENDING },
        });
      } else {
        await tx.order.update({
          where: { id: payment.orderId },
          data: {
            paymentStatus:
              totalPaid >= orderTotal
                ? PaymentStatus.PAID
                : PaymentStatus.PARTIAL_PAID,
          },
        });
      }

      return updated;
    });
    await this.invalidateAnalytics();
    await this.refreshCodAlert(updated.orderId);
    return updated;
  }
}
