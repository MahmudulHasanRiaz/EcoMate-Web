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

  // Storefront resolution: product → legacy category → multi categories.
  // Inactive charts behave as unassigned (admin "Hidden" toggle) — findOne
  // stays unfiltered so the admin panel can still manage inactive charts.
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

    const ids = [
      product.sizeChartId,
      product.category?.sizeChartId,
      ...product.productCategories.map((pc) => pc.category.sizeChartId),
    ].filter(Boolean) as string[];
    for (const id of ids) {
      const chart = await this.findOne(id).catch(() => null);
      if (chart && chart.isActive !== false) return chart;
    }

    return null;
  }
}
