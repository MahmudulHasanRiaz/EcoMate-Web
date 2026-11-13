import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupportEnquiryDto } from './dto/create-support-enquiry.dto';
import { SUPPORT_ENQUIRY_STATUSES } from './dto/update-support-enquiry.dto';

export type SupportEnquiryStatus =
  (typeof SUPPORT_ENQUIRY_STATUSES)[number];

/**
 * Support enquiries (D9) — a simple inbox, NOT a helpdesk: no ticket
 * threading, no assignment, no SLA. Status is NEW / REPLIED only.
 */
@Injectable()
export class SupportEnquiriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public submission. A filled honeypot field means a bot: pretend
   * success and store nothing.
   */
  async create(dto: CreateSupportEnquiryDto) {
    if (dto.website && dto.website.trim() !== '') {
      return { received: true };
    }
    const enquiry = await this.prisma.supportEnquiry.create({
      data: {
        name: dto.name,
        email: dto.email || null,
        phone: dto.phone || null,
        subject: dto.subject || null,
        message: dto.message,
        orderId: dto.orderId || null,
        status: 'NEW',
      },
    });
    return enquiry;
  }

  async findAll(query: {
    status?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = Math.max(1, query.page || 1);
    const perPage = Math.min(100, Math.max(1, query.perPage || 20));
    const where: Record<string, unknown> = {};
    if (query.status !== undefined) {
      if (
        !(SUPPORT_ENQUIRY_STATUSES as readonly string[]).includes(
          query.status,
        )
      ) {
        throw new BadRequestException(
          `status must be one of ${SUPPORT_ENQUIRY_STATUSES.join(', ')}`,
        );
      }
      where.status = query.status;
    }
    const [data, total] = await Promise.all([
      this.prisma.supportEnquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.supportEnquiry.count({ where }),
    ]);
    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: string) {
    const enquiry = await this.prisma.supportEnquiry.findUnique({
      where: { id },
    });
    if (!enquiry) throw new NotFoundException('Support enquiry not found');
    return enquiry;
  }

  async updateStatus(
    id: string,
    status: SupportEnquiryStatus,
    userId?: string,
  ) {
    await this.findOne(id);
    return this.prisma.supportEnquiry.update({
      where: { id },
      data: {
        status,
        // Marking REPLIED stamps who/when; reopening to NEW clears it.
        repliedById: status === 'REPLIED' ? (userId ?? null) : null,
        repliedAt: status === 'REPLIED' ? new Date() : null,
      },
    });
  }
}
