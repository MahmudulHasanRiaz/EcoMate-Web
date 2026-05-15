import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('low-stock')
  async lowStock() {
    const products = await this.prisma.product.findMany({
      where: { manageStock: true, isActive: true },
      select: { id: true, name: true, slug: true, stock: true, lowStockQty: true, sku: true },
    });
    const lowStock = products.filter(p => p.stock <= (p.lowStockQty || 5));
    return { products: lowStock, count: lowStock.length };
  }

  @Get('logs')
  async logs(@Query('page') page?: string, @Query('perPage') perPage?: string, @Query('type') type?: string) {
    const p = page ? parseInt(page) : 1;
    const pp = perPage ? parseInt(perPage) : 20;
    const where: Record<string, unknown> = {};
    if (type) where.type = type;

    const [data, total] = await Promise.all([
      this.prisma.inventoryLog.findMany({
        where: where as any, skip: (p - 1) * pp, take: pp, orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryLog.count({ where: where as any }),
    ]);
    return { data, meta: { total, page: p, perPage: pp, totalPages: Math.ceil(total / pp) } };
  }
}
