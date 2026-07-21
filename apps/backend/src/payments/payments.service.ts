import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus } from '@prisma/client';
import { CreatePaymentDto, VerifyPaymentDto } from '../orders/dto/order.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(
    orderId: string,
    dto: CreatePaymentDto,
    opts?: { userId?: string; token?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the order row first — prevents concurrent payment insert races
      await tx.$queryRawUnsafe(
        'SELECT id FROM "Order" WHERE id = $1 FOR UPDATE',
        orderId,
      );

      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { payments: true },
      });

      // Ownership gate: user must own the order or present a valid viewToken
      const ownsOrder = opts?.userId && order.customerId === opts.userId;
      const hasValidToken = opts?.token && order.viewToken === opts.token;
      if (!ownsOrder && !hasValidToken) {
        throw new NotFoundException('Order not found');
      }

      const paymentAmount = Number(dto.amount);
      if (isNaN(paymentAmount) || paymentAmount <= 0) {
        throw new BadRequestException(
          'Payment amount must be a positive number',
        );
      }

      const orderTotal = Number(order.total);

      // Sum only PAID/PENDING payments for this order
      const totalPaidOrPending = order.payments
        .filter(
          (p) =>
            p.status === PaymentStatus.PAID ||
            p.status === PaymentStatus.PENDING,
        )
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const remainingBalance = Math.max(0, orderTotal - totalPaidOrPending);

      if (paymentAmount > remainingBalance) {
        throw new BadRequestException(
          `Payment amount of ৳${paymentAmount} exceeds the remaining order balance of ৳${remainingBalance.toFixed(2)}`,
        );
      }

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

      return tx.payment.create({
        data: {
          orderId,
          gatewayCode: dto.gatewayCode,
          amount: dto.amount,
          transactionId: dto.transactionId,
          screenshot: dto.screenshot,
          notes: dto.notes,
          status: PaymentStatus.PENDING,
        },
      });
    });
  }

  async verify(id: string, dto: VerifyPaymentDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundException('Payment not found');

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
  }
}
