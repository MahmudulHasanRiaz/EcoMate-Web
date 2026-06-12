import { Injectable, NotFoundException } from '@nestjs/common';
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

  async create(orderId: string, dto: CreatePaymentDto) {
    await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const existing = await this.prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return this.prisma.payment.update({
        where: { id: existing.id },
        data: {
          gatewayCode: dto.gatewayCode,
          amount: dto.amount,
          transactionId: dto.transactionId,
          screenshot: dto.screenshot,
          notes: dto.notes,
          status: PaymentStatus.PENDING,
        },
      });
    }
    return this.prisma.payment.create({
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
  }

  async verify(id: string, dto: VerifyPaymentDto, userId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    const updated = await this.prisma.payment.update({
      where: { id },
      data: {
        status: dto.status as PaymentStatus,
        verifiedBy: userId,
        verifiedAt: new Date(),
        notes: dto.notes ?? payment.notes,
      },
    });
    if (dto.status === PaymentStatus.PAID) {
      const paymentCount = await this.prisma.payment.count({
        where: { orderId: payment.orderId },
      });
      await this.prisma.order.update({
        where: { id: payment.orderId },
        data: {
          paymentStatus: paymentCount === 1 ? PaymentStatus.PAID : PaymentStatus.PARTIAL_PAID,
        },
      });
    }
    return updated;
  }
}
