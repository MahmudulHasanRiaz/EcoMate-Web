import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByProductSlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.review.findMany({
      where: { productId: product.id, approved: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(query: { status?: string; productId?: string }) {
    const where: Record<string, unknown> = {};
    if (query.status === 'pending') where.approved = false;
    if (query.status === 'approved') where.approved = true;
    if (query.productId) where.productId = query.productId;
    return this.prisma.review.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, slug: true, images: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: {
    productId: string;
    customerName: string;
    rating: number;
    text?: string;
  }) {
    if (dto.rating < 1 || dto.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.review.create({ data: { ...dto, approved: false } });
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
      include: {
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
