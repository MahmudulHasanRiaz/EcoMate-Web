import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: { productId: string; customerName: string; rating: number; text?: string }) {
    if (dto.rating < 1 || dto.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.review.create({ data: dto });
  }
}
