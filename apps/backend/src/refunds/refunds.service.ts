import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['completed', 'rejected'],
  completed: [],
  rejected: [],
};

@Injectable()
export class RefundsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: {
    page?: number;
    perPage?: number;
    status?: string;
    orderId?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: Record<string, unknown> = {};
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
    await this.prisma.order.findUniqueOrThrow({ where: { id: dto.orderId } });
    return this.prisma.refund.create({
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
  }

  async updateStatus(
    id: string,
    dto: UpdateRefundStatusDto,
    processedBy: string,
  ) {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException('Refund not found');

    const allowed = VALID_TRANSITIONS[refund.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from "${refund.status}" to "${dto.status}". Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }

    return this.prisma.refund.update({
      where: { id },
      data: {
        status: dto.status,
        processedBy,
        processedAt: new Date(),
        notes: dto.notes ?? refund.notes,
      },
      include: {
        order: { select: { displayId: true } },
        processor: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }
}
