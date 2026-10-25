import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { normalizePhone } from '../common/utils/phone-utils';

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  /**
   * SECURITY (2026-10-25, F27): the per-customer coupon key. Logged-in
   * customers key on their id; guests key on their NORMALIZED phone
   * ('guest:+880…'). Before this, guests wrote userId NULL and the cap
   * was skipped entirely for them — one phone could redeem a
   * "1 per customer" coupon unlimited times. Normalization matters:
   * 017… and +88017… are the same person. A guest with no phone at all
   * has no key and the cap cannot apply (same as before).
   */
  private couponCustomerKey(
    userId?: string | null,
    phone?: string | null,
  ): string | null {
    if (userId) return userId;
    const normalized = phone ? normalizePhone(phone) : null;
    return normalized ? `guest:${normalized}` : null;
  }

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

  async validate(code: string, userId?: string, phone?: string) {
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

    const customerKey = this.couponCustomerKey(userId, phone);
    if (customerKey && coupon.maxUsesPerCustomer) {
      const userUsageCount = await this.prisma.couponUsage.count({
        where: { couponId: coupon.id, userId: customerKey },
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
    phone?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [coupon]: any[] = await tx.$queryRawUnsafe(
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

      const customerKey = this.couponCustomerKey(userId, phone);
      if (customerKey && coupon.maxUsesPerCustomer) {
        const userUsageCount = await tx.couponUsage.count({
          where: { couponId: coupon.id, userId: customerKey },
        });
        if (userUsageCount >= coupon.maxUsesPerCustomer)
          throw new BadRequestException('Per-customer usage limit reached');
      }

      const actualDiscount = discountAmount ?? 0;

      await tx.coupon.update({
        where: { id: coupon.id },
        data: { usedCount: { increment: 1 } },
      });

      await tx.couponUsage.create({
        data: {
          couponId: coupon.id,
          orderId,
          // Count and write use the SAME key, or the cap can never fire
          // for guests (F27). CouponUsage.userId is a plain string, not
          // a FK, so 'guest:+880…' stores cleanly.
          userId: customerKey,
          discount: actualDiscount,
        },
      });

      return { success: true, discount: actualDiscount };
    });
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
