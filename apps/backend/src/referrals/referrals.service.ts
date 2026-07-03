import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClaimReferralDto } from './dto/claim-referral.dto';

@Injectable()
export class ReferralsService {
  constructor(private prisma: PrismaService) {}

  async getOrCreateReferral(userId: string) {
    let referral = await this.prisma.referral.findFirst({
      where: { referrerId: userId },
    });
    if (!referral) {
      const code = await this.generateUniqueCode();
      referral = await this.prisma.referral.create({
        data: { code, referrerId: userId },
      });
    }
    return referral;
  }

  async claimReferral(dto: ClaimReferralDto) {
    const referral = await this.prisma.referral.findUnique({
      where: { code: dto.code },
    });
    if (!referral) throw new NotFoundException('Invalid referral code');
    if (!referral.isActive)
      throw new BadRequestException('Referral code is inactive');

    const existing = await this.prisma.referralLead.findFirst({
      where: { referralId: referral.id, phone: dto.phone },
    });
    if (existing) {
      throw new ConflictException(
        'Phone number already claimed this referral code',
      );
    }

    return this.prisma.referralLead.create({
      data: {
        referralId: referral.id,
        phone: dto.phone,
        name: dto.name,
      },
    });
  }

  async findAll(page = 1, perPage = 20) {
    const [data, total] = await Promise.all([
      this.prisma.referral.findMany({
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          referrer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
            },
          },
          _count: { select: { leads: true } },
        },
      }),
      this.prisma.referral.count(),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { id },
      include: {
        referrer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
          },
        },
        leads: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!referral) throw new NotFoundException('Referral not found');
    return referral;
  }

  async findLeads(referralId: string, page = 1, perPage = 20) {
    const [data, total] = await Promise.all([
      this.prisma.referralLead.findMany({
        where: { referralId },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              displayId: true,
              total: true,
              statusId: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.referralLead.count({ where: { referralId } }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  private async generateUniqueCode(): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 5; attempt++) {
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      const exists = await this.prisma.referral.findUnique({ where: { code } });
      if (!exists) return code;
    }
    throw new Error('Unable to generate unique referral code after 5 attempts');
  }
}
