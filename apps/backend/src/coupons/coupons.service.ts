import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { usages: true } } },
    });
  }

  async findOne(id: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id },
      include: { _count: { select: { usages: true } } },
    });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  async validate(code: string, userId?: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (!coupon) return { valid: false, message: 'Coupon not found' };
    if (!coupon.isActive)
      return { valid: false, message: 'Coupon is no longer active' };
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses)
      return { valid: false, message: 'Coupon usage limit reached' };
    if (coupon.expiresAt && new Date() > coupon.expiresAt)
      return { valid: false, message: 'Coupon has expired' };
    if (coupon.startsAt && new Date() < coupon.startsAt)
      return { valid: false, message: 'Coupon is not yet active' };

    if (userId && coupon.maxUsesPerCustomer) {
      const userUsageCount = await this.prisma.couponUsage.count({
        where: { couponId: coupon.id, userId },
      });
      if (userUsageCount >= coupon.maxUsesPerCustomer)
        return {
          valid: false,
          message: 'You have reached the usage limit for this coupon',
        };
    }

    return {
      valid: true,
      coupon: {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        minOrderValue: coupon.minOrderValue,
        percentageCap: coupon.percentageCap,
      },
    };
  }

  async apply(
    code: string,
    orderId: string,
    userId?: string,
    discountAmount?: number,
  ) {
    const [coupon]: any[] = await this.prisma.$queryRawUnsafe(
      'SELECT id, "isActive", "maxUses", "usedCount", "maxUsesPerCustomer", "expiresAt", "startsAt", "minOrderValue", type, value, "percentageCap" FROM "Coupon" WHERE code = $1 FOR UPDATE',
      code,
    );
    if (!coupon) throw new BadRequestException('Coupon not found');
    if (!coupon.isActive)
      throw new BadRequestException('Coupon is no longer active');
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses)
      throw new BadRequestException('Coupon usage limit reached');
    if (coupon.expiresAt && new Date() > coupon.expiresAt)
      throw new BadRequestException('Coupon has expired');
    if (coupon.startsAt && new Date() < coupon.startsAt)
      throw new BadRequestException('Coupon is not yet active');

    if (userId && coupon.maxUsesPerCustomer) {
      const userUsageCount = await this.prisma.couponUsage.count({
        where: { couponId: coupon.id, userId },
      });
      if (userUsageCount >= coupon.maxUsesPerCustomer)
        throw new BadRequestException('Per-customer usage limit reached');
    }

    const actualDiscount = discountAmount ?? 0;

    await this.prisma.coupon.update({
      where: { id: coupon.id },
      data: { usedCount: { increment: 1 } },
    });

    await this.prisma.couponUsage.create({
      data: { couponId: coupon.id, orderId, userId, discount: actualDiscount },
    });

    return { success: true, discount: actualDiscount };
  }

  async create(dto: CreateCouponDto) {
    const existing = await this.prisma.coupon.findUnique({
      where: { code: dto.code },
    });
    if (existing) throw new ConflictException('Coupon code already exists');

    return this.prisma.coupon.create({
      data: {
        code: dto.code,
        type: dto.type || 'flat',
        value: dto.value,
        minOrderValue: dto.minOrderValue,
        maxUses: dto.maxUses,
        maxUsesPerCustomer: dto.maxUsesPerCustomer,
        percentageCap: dto.percentageCap,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }

  async update(id: string, dto: UpdateCouponDto) {
    await this.findOne(id);
    if (dto.code) {
      const existing = await this.prisma.coupon.findUnique({
        where: { code: dto.code },
      });
      if (existing && existing.id !== id)
        throw new ConflictException('Coupon code already exists');
    }
    return this.prisma.coupon.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.coupon.delete({ where: { id } });
    return { message: 'Deleted' };
  }

  async getUsage(id: string, page = 1, perPage = 20) {
    const where = { couponId: id };
    const [data, total] = await Promise.all([
      this.prisma.couponUsage.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { usedAt: 'desc' },
        include: {
          order: { select: { id: true, displayId: true, total: true } },
        },
      }),
      this.prisma.couponUsage.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }
}
