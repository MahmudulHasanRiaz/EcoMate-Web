import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ValuationQueryDto, StockTransferDto } from './dto/valuation.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async lowStock() {
    const products = await this.prisma.product.findMany({
      where: { manageStock: true, isActive: true, type: { not: 'variable' } },
      select: {
        id: true,
        name: true,
        slug: true,
        stock: true,
        lowStockQty: true,
        sku: true,
      },
    });
    const lowStockProducts = products
      .filter((p) => p.stock <= (p.lowStockQty || 5))
      .map((p) => ({ ...p, type: 'product' as const }));

    const variableProducts = await this.prisma.product.findMany({
      where: { isActive: true, type: 'variable' },
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        lowStockQty: true,
        variants: {
          select: {
            id: true,
            sku: true,
            stock: true,
            attributeValues: {
              include: { attributeValue: { select: { value: true } } },
            },
          },
        },
      },
    });

    const lowStockVariants: Array<{
      id: string;
      name: string;
      slug: string;
      stock: number;
      lowStockQty: number | null;
      sku: string | null;
      type: 'variant';
      variantSku: string;
      variantAttributes: string;
    }> = [];

    for (const product of variableProducts) {
      const threshold = product.lowStockQty || 5;
      for (const variant of product.variants) {
        if (variant.stock <= threshold) {
          const attrs = variant.attributeValues
            .map((av) => av.attributeValue.value)
            .join(' / ');
          lowStockVariants.push({
            id: variant.id,
            name: product.name,
            slug: product.slug,
            stock: variant.stock,
            lowStockQty: threshold,
            sku: product.sku,
            type: 'variant',
            variantSku: variant.sku,
            variantAttributes: attrs || variant.sku,
          });
        }
      }
    }

    const allLowStock = [...lowStockProducts, ...lowStockVariants];
    return { products: allLowStock, count: allLowStock.length };
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

    const productIds = [
      ...new Set(data.map((l) => l.productId).filter(Boolean)),
    ];
    const variantIds = [
      ...new Set(data.map((l) => l.variantId).filter(Boolean)),
    ];
    const comboIds = [...new Set(data.map((l) => l.comboId).filter(Boolean))];

    const [products, variants, combos] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds as string[] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds as string[] } },
            select: {
              id: true,
              sku: true,
              attributeValues: {
                include: { attributeValue: { select: { value: true } } },
              },
            },
          })
        : Promise.resolve(
            [] as {
              id: string;
              sku: string;
              attributeValues: { attributeValue: { value: string } }[];
            }[],
          ),
      comboIds.length
        ? this.prisma.combo.findMany({
            where: { id: { in: comboIds as string[] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const comboMap = new Map(combos.map((c) => [c.id, c]));

    const mapped = data.map((l) => {
      const variant = l.variantId ? variantMap.get(l.variantId) : undefined;
      return {
        ...l,
        productName: l.productId
          ? (productMap.get(l.productId)?.name ?? null)
          : null,
        variantName: variant
          ? variant.attributeValues
              .map((av) => av.attributeValue.value)
              .join(' / ') || variant.sku
          : null,
        comboName: l.comboId ? (comboMap.get(l.comboId)?.name ?? null) : null,
      };
    });

    return {
      data: mapped,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async adjust(
    productId?: string,
    quantity?: number,
    reason?: string,
    performedBy?: string,
    variantId?: string,
    comboId?: string,
  ) {
    if (comboId) {
      const combo = await this.prisma.combo.findUnique({
        where: { id: comboId },
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, type: true, manageStock: true },
              },
              variant: { select: { id: true, sku: true } },
            },
          },
        },
      });
      if (!combo) throw new NotFoundException('Combo not found');

      const adjusted: {
        productId: string;
        productName: string;
        quantity: number;
      }[] = [];
      const skipped: string[] = [];

      for (const item of combo.items) {
        const qty = (quantity || 0) * item.quantity;

        if (item.variantId) {
          await this.prisma.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: qty } },
          });
          await this.prisma.inventoryLog.create({
            data: {
              productId: item.productId,
              variantId: item.variantId,
              comboId,
              quantity: qty,
              type: 'manual_adjustment',
              reason: reason || `Combo "${combo.name}" stock adjustment`,
              performedBy,
            },
          });
          adjusted.push({
            productId: item.productId,
            productName: item.product.name,
            quantity: qty,
          });
        } else if (item.product.manageStock) {
          await this.prisma.product.update({
            where: { id: item.productId },
            data: { stock: { increment: qty } },
          });
          await this.prisma.inventoryLog.create({
            data: {
              productId: item.productId,
              comboId,
              quantity: qty,
              type: 'manual_adjustment',
              reason: reason || `Combo "${combo.name}" stock adjustment`,
              performedBy,
            },
          });
          adjusted.push({
            productId: item.productId,
            productName: item.product.name,
            quantity: qty,
          });
        } else {
          skipped.push(
            `${item.product.name} (stock tracking not enabled — no change needed)`,
          );
        }
      }

      return {
        id: combo.id,
        name: combo.name,
        items: adjusted,
        ...(skipped.length > 0 && {
          info: `${skipped.length} item(s) skipped: ${skipped.join('; ')}`,
        }),
      };
    }

    if (variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        include: {
          product: { select: { id: true, name: true, type: true } },
        },
      });
      if (!variant) throw new NotFoundException('Variant not found');
      const updated = await this.prisma.productVariant.update({
        where: { id: variantId },
        data: { stock: { increment: quantity } },
      });
      await this.prisma.inventoryLog.create({
        data: {
          productId: variant.productId,
          variantId,
          quantity: quantity || 0,
          type: 'manual_adjustment',
          reason: reason || 'Manual variant stock adjustment',
          performedBy,
        },
      });
      return {
        id: variant.id,
        sku: variant.sku,
        stock: updated.stock,
        productId: variant.productId,
        productName: variant.product.name,
      };
    }

    if (!productId)
      throw new BadRequestException(
        'Either productId, variantId, or comboId is required',
      );
    const q = quantity ?? 0;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    if (!product.manageStock) {
      throw new BadRequestException(
        'This product does not manage stock. Stock adjustments are disabled.',
      );
    }

    if (product.type === 'variable') {
      throw new BadRequestException(
        'Variable products use variant-level stock management. Select a specific variant instead.',
      );
    }

    await this.prisma.product.update({
      where: { id: productId },
      data: { stock: { increment: q } },
    });

    await this.prisma.inventoryLog.create({
      data: {
        productId,
        quantity: q,
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

  async restockOrderItems(
    orderId: string,
    performedBy: string,
    logType: 'refund_restock' | 'cancellation_restock' = 'cancellation_restock',
    force = false,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    const alreadyRestocked =
      !force &&
      (await client.inventoryLog.findFirst({
        where: {
          type: { in: ['refund_restock', 'cancellation_restock'] },
          reason: { contains: orderId },
        },
      }));
    if (alreadyRestocked) return;

    const orderItems = await client.orderItem.findMany({
      where: { orderId },
    });

    for (const item of orderItems) {
      if (item.comboId) {
        const combo = await client.combo.findUnique({
          where: { id: item.comboId },
          include: { items: true },
        });
        if (!combo) continue;

        for (const ci of combo.items) {
          const qty = ci.quantity * item.quantity;
          const effectiveVariantId =
            ci.variantId ||
            (item.comboSelection as Record<string, string> | null)?.[
              ci.productId
            ] ||
            null;

          if (effectiveVariantId) {
            await client.productVariant.update({
              where: { id: effectiveVariantId },
              data: { stock: { increment: qty } },
            });
          }
          const product = await client.product.findUnique({
            where: { id: ci.productId },
            select: { manageStock: true },
          });
          if (product?.manageStock) {
            await client.product.update({
              where: { id: ci.productId },
              data: { stock: { increment: qty } },
            });
          }
          await client.inventoryLog.create({
            data: {
              productId: ci.productId,
              variantId: effectiveVariantId,
              comboId: item.comboId,
              quantity: qty,
              type: logType,
              reason: `${logType === 'refund_restock' ? 'Refund' : 'Cancellation'} restock for order ${orderId}`,
              performedBy,
              createdAt: new Date(),
            },
          });
        }
      } else {
        if (item.variantId) {
          await client.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
        const product = item.productId
          ? await client.product.findUnique({
              where: { id: item.productId },
              select: { manageStock: true, type: true },
            })
          : null;
        if (
          product &&
          product.manageStock &&
          item.productId &&
          (!item.variantId || product.type === 'simple')
        ) {
          await client.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await client.inventoryLog.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            type: logType,
            reason: `${logType === 'refund_restock' ? 'Refund' : 'Cancellation'} restock for order ${orderId}`,
            performedBy,
            createdAt: new Date(),
          },
        });
      }
    }
  }

  async stockOverview(params: {
    page?: number;
    perPage?: number;
    search?: string;
    categoryId?: string;
    type?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = params.page || 1;
    const perPage = params.perPage || 20;
    const where: any = { isActive: true };

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { sku: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.type) where.type = params.type;

    const orderBy: any = {};
    if (params.sortBy === 'name') orderBy.name = params.sortOrder || 'asc';
    else if (params.sortBy === 'stock')
      orderBy.stock = params.sortOrder || 'desc';
    else if (params.sortBy === 'price')
      orderBy.basePrice = params.sortOrder || 'desc';
    else orderBy.updatedAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy,
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          type: true,
          stock: true,
          manageStock: true,
          lowStockQty: true,
          basePrice: true,
          salePrice: true,
          images: true,
          categoryId: true,
          category: { select: { id: true, name: true } },
          variants: {
            select: {
              id: true,
              sku: true,
              stock: true,
              price: true,
              attributeValues: {
                include: { attributeValue: { select: { value: true } } },
              },
            },
          },
          _count: { select: { orderItems: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async bulkAdjust(
    items: {
      productId?: string;
      variantId?: string;
      comboId?: string;
      quantity: number;
      reason: string;
    }[],
    performedBy?: string,
  ) {
    const results: any[] = [];
    for (const item of items) {
      try {
        const result = await this.adjust(
          item.productId,
          item.quantity,
          item.reason,
          performedBy,
          item.variantId,
          item.comboId,
        );
        results.push({ ...item, success: true, result });
      } catch (err: any) {
        results.push({ ...item, success: false, error: err.message });
      }
    }
    return { results, totalAdjusted: results.filter((r) => r.success).length };
  }

  async valuation(query: ValuationQueryDto) {
    const where: any = { isActive: true };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        basePrice: true,
        salePrice: true,
        variants: {
          select: {
            id: true,
            sku: true,
            stock: true,
            price: true,
          },
        },
      },
    });

    let totalValue = 0;
    let totalStock = 0;
    const items: any[] = [];

    for (const product of products) {
      if (product.variants.length > 0) {
        for (const v of product.variants) {
          const price = Number(v.price || product.basePrice);
          totalValue += price * v.stock;
          totalStock += v.stock;
          items.push({
            id: v.id,
            type: 'variant',
            sku: v.sku,
            stock: v.stock,
            unitPrice: price,
            totalValue: price * v.stock,
          });
        }
      } else {
        const price = Number(product.salePrice || product.basePrice);
        totalValue += price * product.stock;
        totalStock += product.stock;
        items.push({
          id: product.id,
          type: 'product',
          name: product.name,
          sku: product.sku,
          stock: product.stock,
          unitPrice: price,
          totalValue: price * product.stock,
        });
      }
    }

    return { items, totalValue, totalStock, count: items.length };
  }

  async transfer(dto: StockTransferDto, performedBy?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, name: true, stock: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    await this.prisma.inventoryLog.create({
      data: {
        productId: dto.productId,
        quantity: 0,
        type: 'transfer',
        reason: `Transferred ${dto.quantity} units from ${dto.sourceLocation} to ${dto.destinationLocation}${dto.notes ? ': ' + dto.notes : ''}`,
        performedBy,
      },
    });

    return {
      productId: product.id,
      productName: product.name,
      quantity: dto.quantity,
      source: dto.sourceLocation,
      destination: dto.destinationLocation,
    };
  }
}
