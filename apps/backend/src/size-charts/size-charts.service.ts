import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSizeChartDto, UpdateSizeChartDto } from './dto/size-chart.dto';

@Injectable()
export class SizeChartsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.sizeChart.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const chart = await this.prisma.sizeChart.findUnique({ where: { id } });
    if (!chart) throw new NotFoundException('Size chart not found');
    return chart;
  }

  async create(dto: CreateSizeChartDto) {
    return this.prisma.sizeChart.create({
      data: dto as any,
    });
  }

  async update(id: string, dto: UpdateSizeChartDto) {
    const chart = await this.prisma.sizeChart.findUnique({ where: { id } });
    if (!chart) throw new NotFoundException('Size chart not found');
    return this.prisma.sizeChart.update({
      where: { id },
      data: dto as any,
    });
  }

  async remove(id: string) {
    const chart = await this.prisma.sizeChart.findUnique({ where: { id } });
    if (!chart) throw new NotFoundException('Size chart not found');
    await this.prisma.sizeChart.delete({ where: { id } });
    return { message: 'Size chart deleted' };
  }

  async findByProductSlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: {
        sizeChartId: true,
        category: { select: { sizeChartId: true } },
        productCategories: {
          select: { category: { select: { sizeChartId: true } } },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    if (product.sizeChartId) {
      return this.findOne(product.sizeChartId);
    }

    if (product.category?.sizeChartId) {
      return this.findOne(product.category.sizeChartId);
    }

    for (const pc of product.productCategories) {
      if (pc.category.sizeChartId) {
        return this.findOne(pc.category.sizeChartId);
      }
    }

    return null;
  }
}
