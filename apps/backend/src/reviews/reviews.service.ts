import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/utils/phone-utils';

// Public review shape — `mobile` is NEVER selected here. Admin `findAll`
// keeps full rows (mobile included, admin-only endpoint).
const PUBLIC_REVIEW_SELECT = {
  id: true,
  productId: true,
  customerName: true,
  rating: true,
  text: true,
  approved: true,
  createdAt: true,
} as const;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByProductSlug(slug: string, page: number = 1, limit: number = 10) {
    page = Math.max(1, page);
    limit = Math.max(1, Math.min(100, limit));
    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    const where = { productId: product.id, approved: true };
    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        select: PUBLIC_REVIEW_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findAll(query: {
    status?: string;
    productId?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: Record<string, unknown> = {};
    if (query.status === 'pending') where.approved = false;
    if (query.status === 'approved') where.approved = true;
    if (query.productId) where.productId = query.productId;
    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          product: {
            select: { id: true, name: true, slug: true, images: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async create(dto: {
    productId: string;
    customerName?: string;
    rating?: number;
    text?: string;
    mobile: string;
  }) {
    // Rating is optional: a missing rating stores NULL (excluded from
    // averages) instead of an inflated 5-star default.
    const rating = dto.rating ?? null;
    if (rating !== null && (rating < 1 || rating > 5)) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    const mobile = normalizePhone(dto.mobile || '');
    if (!mobile) {
      throw new BadRequestException(
        'Please enter a valid Bangladeshi mobile number.',
      );
    }
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) throw new NotFoundException('Product not found');
    const existing = await this.prisma.review.findFirst({
      where: {
        productId: dto.productId,
        OR: [
          { mobile },
          ...(dto.customerName ? [{ customerName: dto.customerName }] : []),
        ],
      },
    });
    if (existing) {
      throw new BadRequestException('You have already reviewed this product');
    }
    return this.prisma.review.create({
      data: {
        productId: dto.productId,
        customerName: dto.customerName || 'Verified Buyer',
        rating,
        text: dto.text,
        mobile,
        approved: false,
      },
    });
  }

  async approve(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    return this.prisma.review.update({
      where: { id },
      data: { approved: true },
    });
  }

  async findLatest(limit: number = 6) {
    return this.prisma.review.findMany({
      where: { approved: true },
      select: {
        ...PUBLIC_REVIEW_SELECT,
        product: { select: { id: true, name: true, slug: true, images: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async remove(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    return this.prisma.review.delete({ where: { id } });
  }
}
