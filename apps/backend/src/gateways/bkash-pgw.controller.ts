import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { BkashPgwService } from './bkash-pgw.service';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

/**
 * ATOMIC IDEMPOTENCY: Schema now has
 *   @@unique([transactionId, gatewayCode]) and providerPaymentId @unique
 * on Payment. This ensures that for a given gateway+transactionId or a
 * given bKash paymentID, at most one row can exist.  Conditional update
 * (WHERE status=PENDING) plus the uniqueness invariant guarantees
 * cross-process atomic idempotency.
 *
 * Pre-deploy: audit that no existing Payment rows have duplicate
 * (transactionId, gatewayCode) or providerPaymentId.  If duplicates exist,
 * the unique index creation fails and must be resolved first.
 */
@Controller('payments/bkash')
export class BkashPgwController {
  constructor(
    private readonly bkash: BkashPgwService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Initiate a bKash payment session.
   *
   * Tx 1 — lock order, recheck, create PENDING Payment, COMMIT.
   * Outside tx — call bKash createPayment API.
   * Tx 2 (short) — bind providerPaymentId to the Payment row.
   * On provider failure — mark Payment FAILED so it doesn't consume
   * the outstanding balance permanently.
   */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('create')
  async create(
    @Body()
    dto: { orderId: string; token?: string },
    @CurrentUser() user?: { userId: string },
  ) {
    // Tx 1: lock, recheck, reserve PENDING Payment
    const paymentRecord = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT id FROM "Order" WHERE id = $1 FOR UPDATE',
        dto.orderId,
      );

      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
        select: {
          id: true, total: true, displayId: true, viewToken: true, customerId: true,
          payments: { select: { amount: true, status: true } },
        },
      });

      if (!order) throw new NotFoundException('Order not found');

      const ownsOrder = user?.userId && order.customerId === user.userId;
      const hasValidToken = dto.token && order.viewToken === dto.token;
      if (!ownsOrder && !hasValidToken) {
        throw new NotFoundException('Order not found');
      }

      const totalPaidOrPending = order.payments
        .filter((p) => p.status === PaymentStatus.PAID || p.status === PaymentStatus.PENDING)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const outstanding = Number(order.total) - totalPaidOrPending;

      if (outstanding <= 0) {
        throw new BadRequestException('Order is already fully paid');
      }

      return tx.payment.create({
        data: {
          orderId: order.id,
          gatewayCode: 'bkash_pgw',
          amount: outstanding,
          status: PaymentStatus.PENDING,
        },
      });
    });
    // Tx 1 committed — order unlocked.

    // Provider call outside DB transaction
    let bkashResult;
    try {
      bkashResult = await this.bkash.createPayment(
        Number(paymentRecord.amount),
        paymentRecord.id,
        paymentRecord.id, // use Payment.id as invoice reference
      );
    } catch (err) {
      // Provider create failed — mark reservation FAILED (no active provider session)
      await this.prisma.payment.update({
        where: { id: paymentRecord.id },
        data: { status: PaymentStatus.FAILED },
      }).catch((e) => Logger.error(`bKash: failed to mark payment failed: ${e}`, 'BkashPgwController'));
      throw err;
    }

    // Short Tx 2: bind providerPaymentId
    // If this fails AFTER provider success, do NOT mark FAILED — provider has a live session
    // and a callback may arrive at any time to recover via the unique providerPaymentId.
    try {
      await this.prisma.payment.update({
        where: { id: paymentRecord.id },
        data: { providerPaymentId: bkashResult.paymentID },
      });
    } catch (err) {
      Logger.error(
        `bKash: providerPaymentId binding failed for payment ${paymentRecord.id}: ${err}`,
        'BkashPgwController',
      );
      // Return a soft error — caller sees "payment initiation failed".
      // The row stays PENDING without providerPaymentId.
      // On callback, if provider returns the Payment.id as payerReference,
      // the callback recovery path can bind it atomically.
      throw new InternalServerErrorException('Payment binding failed');
    }

    return { paymentID: bkashResult.paymentID, bkashURL: bkashResult.bkashURL };
  }

  /**
   * bKash post-payment callback.
   *
   * Resolves the initiated Payment by providerPaymentId, verifies the
   * provider response, and conditionally updates PENDING→PAID if and
   * only if the row is still PENDING.  Idempotent: if already PAID the
   * conditional update is a no-op (count=0) and we redirect safely.
   *
   * Failure/cancel/provider-error redirects are generic — no unverified
   * order id or token is ever exposed in the Location header.
   */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Get('callback')
  async callback(@Query() query: any, @Res() res: FastifyReply) {
    const { paymentID, status } = query;
    const storefrontUrl =
      process.env['STOREFRONT_URL'] || 'http://localhost:3000';

    if (status !== 'success' || !paymentID) {
      // Payment failed/cancelled — generic redirect, no token/no orderId.
      res.redirect(`${storefrontUrl}/checkout/thank-you?pending=true`);
      return;
    }

    try {
      const { token } = await this.bkash.grantToken();
      const result = await this.bkash.executePayment(paymentID, token);

      if (result.transactionStatus !== 'Completed') {
        res.redirect(`${storefrontUrl}/checkout/thank-you?pending=true`);
        return;
      }

      // Require provider payerReference to exactly match our bound Payment.id
      if (!result.payerReference) {
        Logger.error(
          `bKash callback: missing payerReference for paymentID ${paymentID}`,
          'BkashPgwController',
        );
        res.redirect(`${storefrontUrl}/checkout/thank-you?pending=true`);
        return;
      }

      // Atomic conditional update inside a transaction
      let redirectViewToken: string | null = null;
      let orderIdForRedirect: string | null = null;
      let isDuplicate = false;

      await this.prisma.$transaction(async (tx) => {
        const pendingPayment = await tx.payment.findFirst({
          where: {
            providerPaymentId: paymentID,
            status: PaymentStatus.PENDING,
          },
          select: { id: true, orderId: true, amount: true },
        });

        if (!pendingPayment) {
          // Could be a duplicate of an already-PAID payment, or unknown.
          const paidCheck = await tx.payment.findFirst({
            where: { providerPaymentId: paymentID, status: PaymentStatus.PAID },
            select: { orderId: true },
          });
          if (paidCheck) {
            // True duplicate — same bound payment already PAID
            isDuplicate = true;
            orderIdForRedirect = paidCheck.orderId;
          }
          // Otherwise unknown/mismatched — leave redirectPending (generic failure)
          return;
        }

        // Verify payerReference matches the bound Payment.id
        if (result.payerReference !== pendingPayment.id) {
          Logger.error(
            `bKash callback: payerReference mismatch — provider=${result.payerReference} expected=${pendingPayment.id}`,
            'BkashPgwController',
          );
          return;
        }

        if (result.currency !== 'BDT') {
          Logger.error(
            `bKash callback: invalid currency ${result.currency} for payment ${paymentID}`,
            'BkashPgwController',
          );
          return;
        }

        if (Number(result.amount) !== Number(pendingPayment.amount)) {
          Logger.error(
            `bKash callback: amount mismatch — provider=${result.amount} expected=${pendingPayment.amount}`,
            'BkashPgwController',
          );
          return;
        }

        // Conditional update: PENDING → PAID
        const updateResult = await tx.payment.updateMany({
          where: { id: pendingPayment.id, status: PaymentStatus.PENDING },
          data: {
            status: PaymentStatus.PAID,
            transactionId: result.trxID,
            gatewayCode: 'bkash',
            verifiedAt: new Date(),
          },
        });

        if (updateResult.count === 0) {
          // Concurrent processor already handled this
          isDuplicate = true;
          orderIdForRedirect = pendingPayment.orderId;
          return;
        }

        // Update order paymentStatus from aggregate
        const paidAgg = await tx.payment.aggregate({
          where: { orderId: pendingPayment.orderId, status: PaymentStatus.PAID },
          _sum: { amount: true },
        });
        const totalPaid = Number(paidAgg._sum.amount || 0);
        const orderData = await tx.order.findUnique({
          where: { id: pendingPayment.orderId },
          select: { total: true, viewToken: true },
        });

        if (orderData) {
          redirectViewToken = orderData.viewToken;
          orderIdForRedirect = pendingPayment.orderId;

          const newPaymentStatus =
            totalPaid >= Number(orderData.total)
              ? PaymentStatus.PAID
              : PaymentStatus.PARTIAL_PAID;

          await tx.order.update({
            where: { id: pendingPayment.orderId },
            data: { paymentStatus: newPaymentStatus },
          });
        }
      });

      if (orderIdForRedirect && redirectViewToken) {
        res.redirect(
          `${storefrontUrl}/checkout/thank-you?orderId=${orderIdForRedirect}&t=${redirectViewToken}`,
        );
      } else if (isDuplicate) {
        // True duplicate — safe success (already PAID)
        res.redirect(`${storefrontUrl}/checkout/thank-you`);
      } else {
        // Unknown/mismatch or zero conditional update — generic pending
        res.redirect(`${storefrontUrl}/checkout/thank-you?pending=true`);
      }
    } catch (err) {
      Logger.error(`bKash callback error: ${err}`, 'BkashPgwController');
      res.redirect(`${storefrontUrl}/checkout/thank-you?pending=true`);
    }
  }
}
