import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { CodMismatchService } from '../cod-mismatch/cod-mismatch.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface GrantOverpaymentArgs {
  customerId: string;
  orderId: string;
  paymentId: string;
  orderTotal: number;
  paidBefore: number;
  newAmount: number;
  isPaid: boolean;
}

/**
 * Task 8 — per-customer credit ledger.
 *
 * Grant: overpayment on a PAID payment insert grants the MARGINAL excess
 * (excessAfter − excessBefore, clamped ≥ 0) as a positive CustomerCreditEntry,
 * so each payment grants only its own overpay — never the whole excess.
 *
 * Apply: staff-initiated by design ("offer apply credit"). Any staff role may
 * apply (record action, D3) — the actor is recorded in recordedBy /
 * entry.createdBy, so no approve_payments gate (that permission is for
 * verifying OTHER staff's entries). The applied amount is clamped to the
 * balance and the balance can never go negative: the customer row is locked
 * (SELECT ... FOR UPDATE) and the balance is re-read inside the same $tx.
 *
 * Money-arithmetic decision (documented): a customer_credit payment row
 * carries the covered amount in `amount` with `appliedCreditAmount = NULL`.
 * Coverage per the shared recompute is Σ(PAID amount) + Σ(appliedCreditAmount),
 * so setting both would double-count the same taka in systemDue. Provenance
 * lives in gatewayCode/account ('customer_credit') + the linked negative
 * credit entry (paymentId). The grant path is a pure credit entry (no payment
 * row, no appliedCreditAmount) — it does not change paidTotal.
 */
@Injectable()
export class CustomerCreditService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: CacheService,
    // Shared COD alert recompute (Feature A) + analytics cache. Optional so
    // unit tests that build the service without them keep working.
    @Optional() private readonly codMismatch?: CodMismatchService,
  ) {}

  /**
   * Post-dispatch COD alert refresh. Resilient — mirrors invalidateAnalytics:
   * an alert failure must never break the credit mutation.
   */
  private async refreshCodAlert(orderId: string): Promise<void> {
    try {
      await this.codMismatch?.recompute(orderId);
    } catch {
      /* alert failure must not fail credit apply */
    }
  }

  private async invalidateAnalytics(): Promise<void> {
    try {
      await this.cache?.invalidateByPrefix('analytics:');
    } catch {
      /* cache failure must not fail credit apply */
    }
  }

  async balance(customerId: string): Promise<number> {
    const agg = await this.prisma.customerCreditEntry.aggregate({
      where: { customerId },
      _sum: { amount: true },
    });
    return round2(Number(agg._sum.amount ?? 0));
  }

  /**
   * Marginal overpay grant. Called from PaymentsService.create INSIDE the
   * payment $transaction (cross-service tx pattern: tx passed first, mirroring
   * CustomerAddressService.syncFromOrder(tx, ...)). Returns the created entry
   * or null when there is nothing new to grant.
   */
  async grantFromOverpayment(tx: any, args: GrantOverpaymentArgs) {
    if (!args.isPaid) return null;
    const orderTotal = Number(args.orderTotal);
    const paidBefore = Number(args.paidBefore);
    const newAmount = Number(args.newAmount);
    if (
      [orderTotal, paidBefore, newAmount].some((n) => isNaN(n)) ||
      newAmount <= 0
    ) {
      return null;
    }
    const excessBefore = Math.max(0, paidBefore - orderTotal);
    const excessAfter = Math.max(0, paidBefore + newAmount - orderTotal);
    const marginal = round2(excessAfter - excessBefore);
    if (marginal <= 0) return null;
    return tx.customerCreditEntry.create({
      data: {
        customerId: args.customerId,
        orderId: args.orderId,
        paymentId: args.paymentId,
        amount: marginal,
        reason: `overpayment:${args.orderId}`,
      },
    });
  }

  /**
   * Staff applies customer credit against an order: creates a PAID
   * customer_credit payment row + a matching negative credit entry, atomically.
   * The applied amount is clamped to the live balance (never negative).
   */
  async applyCredit(orderId: string, amount: number | string, userId: string) {
    const requested = Number(amount);
    if (isNaN(requested) || requested <= 0) {
      throw new BadRequestException('Credit amount must be a positive number');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found');
      const customerId = (order as any).customerId;
      if (!customerId) {
        throw new BadRequestException(
          'Order has no customer — credit cannot be applied',
        );
      }
      // Lock the customer row — serializes concurrent applies so two
      // simultaneous requests cannot both spend the same balance.
      await tx.$queryRawUnsafe(
        'SELECT id FROM "CustomerProfile" WHERE id = $1 FOR UPDATE',
        customerId,
      );
      const agg = await tx.customerCreditEntry.aggregate({
        where: { customerId },
        _sum: { amount: true },
      });
      const bal = Number(agg._sum.amount ?? 0);
      const use = round2(Math.min(requested, bal));
      if (use <= 0) throw new BadRequestException('No credit available');
      const now = new Date();
      const payment = await tx.payment.create({
        data: {
          orderId,
          gatewayCode: 'customer_credit',
          account: 'customer_credit',
          amount: use,
          // NULL by design: coverage = Σ(PAID amount) + Σ(appliedCreditAmount)
          // — setting both would double-count this taka in systemDue.
          appliedCreditAmount: null,
          status: PaymentStatus.PAID,
          recordedBy: `staff:${userId}`,
          submittedBy: `staff:${userId}`,
          verifiedBy: userId,
          verifiedAt: now,
          recordedAt: now,
        },
      });
      const entry = await tx.customerCreditEntry.create({
        data: {
          customerId,
          orderId,
          paymentId: payment.id,
          amount: -use,
          reason: `applied:${orderId}`,
          createdBy: userId,
        },
      });
      return { payment, entry, applied: use, balance: round2(bal - use) };
    });
    await this.invalidateAnalytics();
    await this.refreshCodAlert(orderId);
    return result;
  }

  /** Profile ledger: live balance + entries newest-first (Task 11 UI). */
  async getProfile(customerId: string) {
    const [agg, entries] = await Promise.all([
      this.prisma.customerCreditEntry.aggregate({
        where: { customerId },
        _sum: { amount: true },
      }),
      this.prisma.customerCreditEntry.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { balance: round2(Number(agg._sum.amount ?? 0)), entries };
  }
}
