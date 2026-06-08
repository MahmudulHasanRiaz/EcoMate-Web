import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async lowStock() {
    const products = await this.prisma.product.findMany({
      where: { manageStock: true, isActive: true, type: { not: 'variable' } },
      select: { id: true, name: true, slug: true, stock: true, lowStockQty: true, sku: true },
    });
    const lowStock = products.filter((p) => p.stock <= (p.lowStockQty || 5));
    return { products: lowStock, count: lowStock.length };
  }

  async logs(page = 1, perPage = 20, type?: string) {
    const where: any = {};
    if (type) where.type = type;
    const [data, total] = await Promise.all([
      this.prisma.inventoryLog.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryLog.count({ where }),
    ]);
    return { data, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } };
  }

  async adjust(productId: string, quantity: number, reason: string, performedBy?: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    if (!product.manageStock) {
      throw new BadRequestException('This product does not manage stock. Stock adjustments are disabled.');
    }

    if (product.type === 'variable') {
      throw new BadRequestException('Variable products use variant-level stock management. Adjust stock at the variant level.');
    }

    await this.prisma.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity } },
    });

    await this.prisma.inventoryLog.create({
      data: {
        productId,
        quantity,
        type: 'manual_adjustment',
        reason: reason || 'Manual stock adjustment',
        performedBy,
      },
    });

    return this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, stock: true, sku: true },
    });
  }

  async bulkAdjust(items: { productId: string; quantity: number; reason: string }[], performedBy?: string) {
    const results: any[] = [];
    for (const item of items) {
      try {
        const result = await this.adjust(item.productId, item.quantity, item.reason, performedBy);
        results.push({ ...item, success: true, result });
      } catch (err: any) {
        results.push({ ...item, success: false, error: err.message });
      }
    }
    return { results, totalAdjusted: results.filter((r) => r.success).length };
  }
}
