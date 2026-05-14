import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto, VerifyPaymentDto } from '../orders/dto/order.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: { page?: number; perPage?: number; method?: string; status?: string; orderId?: string }) {
    const page = query.page || 1; const perPage = query.perPage || 10; const where: any = {};
    if (query.method) where.method = query.method;
    if (query.status) where.status = query.status;
    if (query.orderId) where.orderId = query.orderId;
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where, skip: (page - 1) * perPage, take: perPage, orderBy: { createdAt: 'desc' },
        include: { order: { select: { displayId: true } }, verifier: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { data, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } };
  }

  async create(orderId: string, dto: CreatePaymentDto) {
    await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    return this.prisma.payment.create({
      data: { orderId, method: dto.method, amount: dto.amount, transactionId: dto.transactionId, screenshot: dto.screenshot, notes: dto.notes },
    });
  }

  async verify(id: string, dto: VerifyPaymentDto, userId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    return this.prisma.payment.update({
      where: { id },
      data: { status: dto.status, verifiedBy: userId, verifiedAt: new Date(), notes: dto.notes || payment.notes },
    });
  }
}
