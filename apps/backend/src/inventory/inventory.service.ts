import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { ManagedStockLedgerService } from './managed-stock-ledger.service';
import {
  Prisma,
  ManagedStockMovementType,
  MovementDirection,
  ReferenceEntity,
} from '@prisma/client';
import { ValuationQueryDto, StockTransferDto } from './dto/valuation.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly managedStockLedgerService: ManagedStockLedgerService,
  ) {}

  async lowStock() {
    const products = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        stock: number;
        lowStockQty: number | null;
        sku: string | null;
      }>
    >`
      SELECT id, name, slug, stock, "lowStockQty", sku
      FROM "Product"
      WHERE "availabilityMode" = 'MANAGED_STOCK'
        AND "isActive" = true
        AND type != 'variable'
        AND stock <= COALESCE("lowStockQty", 5)
      ORDER BY name ASC
    `;
    const lowStockProducts = products.map((p) => ({
      ...p,
      type: 'product' as const,
    }));

    const variableProducts = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        sku: string | null;
        lowStockQty: number | null;
        variantId: string;
        variantSku: string | null;
        variantStock: number;
        variantAttributes: string | null;
      }>
    >`
      SELECT
        p.id,
        p.name,
        p.slug,
        p.sku,
        p."lowStockQty",
        pv.id AS "variantId",
        pv.sku AS "variantSku",
        pv.managedStockQuantity AS "variantStock",
        COALESCE(
          (SELECT string_agg(av.value, ' / ' ORDER BY av.value)
           FROM "ProductVariantAttributeValue" pvav
           JOIN "AttributeValue" av ON av.id = pvav."attributeValueId"
           WHERE pvav."variantId" = pv.id),
          pv.sku
        ) AS "variantAttributes"
      FROM "Product" p
      JOIN "ProductVariant" pv ON pv."productId" = p.id
      WHERE p."isActive" = true
        AND p.type = 'variable'
        AND p."availabilityMode" = 'MANAGED_STOCK'
        AND pv.managedStockQuantity <= COALESCE(p."lowStockQty", 5)
      ORDER BY p.name ASC
    `;
    const lowStockVariants = variableProducts.map((v) => ({
      id: v.variantId,
      name: v.name,
      slug: v.slug,
      stock: v.variantStock,
      lowStockQty: v.lowStockQty,
      sku: v.sku,
      type: 'variant' as const,
      variantSku: v.variantSku || '',
      variantAttributes: v.variantAttributes || v.variantSku || '',
    }));

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
    {
      const guardProduct: any = productId
        ? await this.prisma.product.findUnique({ where: { id: productId } })
        : variantId
          ? (
              await this.prisma.productVariant.findUnique({
                where: { id: variantId },
                include: { product: true },
              })
            )?.product
          : null;

      if (guardProduct) {
        if (guardProduct.availabilityMode === 'ALWAYS_IN_STOCK') {
          throw new BadRequestException(
            'Product is always in stock — no adjustments allowed',
          );
        }
        if (guardProduct.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
          throw new BadRequestException(
            'Product is always out of stock — no adjustments allowed',
          );
        }
        if (guardProduct.availabilityMode === 'INVENTORY_CONTROLLED') {
          throw new BadRequestException(
            'Use Purchase Orders for inventory-controlled products',
          );
        }
        if (!guardProduct.manageStock) {
          throw new BadRequestException(
            'Stock tracking is disabled for this product',
          );
        }
      }
    }

    if (comboId) {
      const combo = await this.prisma.combo.findUnique({
        where: { id: comboId },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  manageStock: true,
                  managedStockQuantity: true,
                },
              },
              variant: {
                select: { id: true, sku: true, managedStockQuantity: true },
              },
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
          const avail = item.variant?.managedStockQuantity ?? 0;
          if (qty < 0 && avail + qty < 0) {
            throw new BadRequestException(
              `Insufficient stock for variant ${item.variant?.sku ?? 'unknown'}. Available: ${avail}, needed: ${Math.abs(qty)}.`,
            );
          }
          await this.prisma.productVariant.update({
            where: { id: item.variantId },
            data: { managedStockQuantity: { increment: qty } },
          });
          const before = item.variant?.managedStockQuantity ?? 0;
          await this.managedStockLedgerService.record({
            productId: item.productId,
            variantId: item.variantId,
            quantity: Math.abs(qty),
            direction: qty > 0 ? MovementDirection.IN : MovementDirection.OUT,
            type:
              qty > 0
                ? ManagedStockMovementType.MANUAL_ADD
                : ManagedStockMovementType.MANUAL_REMOVE,
            stockBefore: before,
            stockAfter: before + qty,
            referenceType: ReferenceEntity.ADJUSTMENT,
            referenceId: comboId,
            note: reason || `Combo "${combo.name}" stock adjustment`,
            performedById: performedBy,
          });
          adjusted.push({
            productId: item.productId,
            productName: item.product.name,
            quantity: qty,
          });
        } else if (item.product.manageStock) {
          const avail = item.product.managedStockQuantity;
          if (qty < 0 && avail + qty < 0) {
            throw new BadRequestException(
              `Insufficient stock for product ${item.product.name}. Available: ${avail}, needed: ${Math.abs(qty)}.`,
            );
          }
          await this.prisma.product.update({
            where: { id: item.productId },
            data: { managedStockQuantity: { increment: qty } },
          });
          const before = item.product.managedStockQuantity;
          await this.managedStockLedgerService.record({
            productId: item.productId,
            quantity: Math.abs(qty),
            direction: qty > 0 ? MovementDirection.IN : MovementDirection.OUT,
            type:
              qty > 0
                ? ManagedStockMovementType.MANUAL_ADD
                : ManagedStockMovementType.MANUAL_REMOVE,
            stockBefore: before,
            stockAfter: before + qty,
            referenceType: ReferenceEntity.ADJUSTMENT,
            referenceId: comboId,
            note: reason || `Combo "${combo.name}" stock adjustment`,
            performedById: performedBy,
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
      const q = quantity ?? 0;
      if (q < 0 && variant.managedStockQuantity + q < 0) {
        throw new BadRequestException(
          `Insufficient stock for variant ${variant.sku}. Available: ${variant.managedStockQuantity}, needed: ${Math.abs(q)}.`,
        );
      }
      const op =
        q >= 0
          ? this.stockService.add.bind(this.stockService)
          : this.stockService.scrap.bind(this.stockService);
      const targets = await op({
        productId: variant.productId,
        variantId,
        quantity: Math.abs(q),
        reference: reason ? `adjust-${reason}` : 'manual-adjustment',
      });
      return {
        id: variant.id,
        sku: variant.sku,
        stock: variant.managedStockQuantity + q,
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

    if (q < 0 && product.managedStockQuantity + q < 0) {
      throw new BadRequestException(
        `Insufficient stock for product ${product.name}. Available: ${product.managedStockQuantity}, needed: ${Math.abs(q)}.`,
      );
    }

    return this.adjustProductWithRetry(
      productId,
      q,
      reason || 'Manual stock adjustment',
      performedBy,
    );
  }

  private async adjustProductWithRetry(
    productId: string,
    quantity: number,
    reason: string,
    performedBy?: string,
  ) {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const product = await tx.product.findUnique({
              where: { id: productId },
            });
            if (!product) throw new NotFoundException('Product not found');

            const op =
              quantity >= 0
                ? this.stockService.add.bind(this.stockService)
                : this.stockService.scrap.bind(this.stockService);
            await op({
              productId,
              quantity: Math.abs(quantity),
              reference: `adjust-${reason}`,
              performedBy,
              tx,
            });

            return tx.product.findUnique({
              where: { id: productId },
              select: {
                id: true,
                name: true,
                managedStockQuantity: true,
                sku: true,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < MAX_RETRIES
        ) {
          continue;
        }
        throw error;
      }
    }
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

    const ledgerType =
      logType === 'refund_restock'
        ? ManagedStockMovementType.RETURN
        : ManagedStockMovementType.CANCEL_RELEASE;

    const orderItems = await client.orderItem.findMany({
      where: { orderId },
    });

    for (const item of orderItems) {
      const product = item.productId
        ? await client.product.findUnique({
            where: { id: item.productId },
            select: {
              id: true,
              availabilityMode: true,
              manageStock: true,
              type: true,
              managedStockQuantity: true,
            },
          })
        : null;

      if (!product) continue;

      const isManaged =
        product.availabilityMode === 'MANAGED_STOCK' ||
        (!product.availabilityMode && product.manageStock);
      const isInventoryControlled =
        product.availabilityMode === 'INVENTORY_CONTROLLED';
      const isAlwaysIn = product.availabilityMode === 'ALWAYS_IN_STOCK';
      const isAlwaysOut = product.availabilityMode === 'ALWAYS_OUT_OF_STOCK';

      if (isAlwaysIn || isAlwaysOut) continue;

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

          if (isManaged) {
            const execOp = async (client: any) => {
              if (effectiveVariantId) {
                await this.stockService.add({
                  productId: ci.productId,
                  variantId: effectiveVariantId,
                  quantity: qty,
                  reference: `restock-${orderId}`,
                  tx: client,
                });
              }
              const ciProduct = await client.product.findUnique({
                where: { id: ci.productId },
                select: {
                  manageStock: true,
                  type: true,
                  managedStockQuantity: true,
                },
              });
              if (
                ciProduct?.manageStock &&
                (!effectiveVariantId || ciProduct.type === 'simple')
              ) {
                await this.stockService.add({
                  productId: ci.productId,
                  quantity: qty,
                  reference: `restock-${orderId}`,
                  tx: client,
                });
              }
            };
            if (tx) {
              await execOp(tx);
            } else {
              await this.prisma.$transaction(execOp);
            }
          }

          if (isInventoryControlled || isManaged) {
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
        }
      } else {
        if (isManaged) {
          if (item.variantId) {
            await this.stockService.add({
              productId: item.productId || undefined,
              variantId: item.variantId,
              quantity: item.quantity,
              reference: `restock-${orderId}`,
              tx: tx || undefined,
            });
          }
          if (
            product.manageStock &&
            item.productId &&
            (!item.variantId || product.type === 'simple')
          ) {
            await this.stockService.add({
              productId: item.productId,
              quantity: item.quantity,
              reference: `restock-${orderId}`,
              tx: tx || undefined,
            });
          }
        }

        if (isInventoryControlled || isManaged) {
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
      orderBy.managedStockQuantity = params.sortOrder || 'desc';
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
          availabilityMode: true,
          managedStockQuantity: true,
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
              managedStockQuantity: true,
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

    const dataWithAvailableStock = data.map((p) => ({
      ...p,
      availableStock:
        p.availabilityMode === 'MANAGED_STOCK'
          ? p.managedStockQuantity
          : p.availabilityMode === 'INVENTORY_CONTROLLED'
            ? 0
            : p.availabilityMode === 'ALWAYS_IN_STOCK'
              ? null
              : 0,
      variants: p.variants.map((v) => ({
        ...v,
        availableStock:
          p.availabilityMode === 'MANAGED_STOCK'
            ? v.managedStockQuantity
            : p.availabilityMode === 'INVENTORY_CONTROLLED'
              ? 0
              : p.availabilityMode === 'ALWAYS_IN_STOCK'
                ? null
                : 0,
      })),
    }));

    return {
      data: dataWithAvailableStock,
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
    const where: any = { isActive: true, availabilityMode: 'MANAGED_STOCK' };
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
        managedStockQuantity: true,
        basePrice: true,
        salePrice: true,
        variants: {
          select: {
            id: true,
            sku: true,
            managedStockQuantity: true,
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
          totalValue += price * v.managedStockQuantity;
          totalStock += v.managedStockQuantity;
          items.push({
            id: v.id,
            type: 'variant',
            sku: v.sku,
            stock: v.managedStockQuantity,
            unitPrice: price,
            totalValue: price * v.managedStockQuantity,
          });
        }
      } else {
        const price = Number(product.salePrice || product.basePrice);
        totalValue += price * product.managedStockQuantity;
        totalStock += product.managedStockQuantity;
        items.push({
          id: product.id,
          type: 'product',
          name: product.name,
          sku: product.sku,
          stock: product.managedStockQuantity,
          unitPrice: price,
          totalValue: price * product.managedStockQuantity,
        });
      }
    }

    return { items, totalValue, totalStock, count: items.length };
  }

  async getLedger(query: LedgerQueryDto) {
    return this.managedStockLedgerService.find({
      productId: query.productId,
      variantId: query.variantId,
      page: query.page,
      perPage: query.perPage,
    });
  }

  async transfer(dto: StockTransferDto, performedBy?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, name: true, managedStockQuantity: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const [sourceWarehouse, destWarehouse] = await Promise.all([
      this.prisma.warehouse.findUnique({ where: { id: dto.sourceLocation } }),
      this.prisma.warehouse.findUnique({
        where: { id: dto.destinationLocation },
      }),
    ]);
    if (!sourceWarehouse) {
      throw new NotFoundException(
        `Source warehouse ${dto.sourceLocation} not found`,
      );
    }
    if (!destWarehouse) {
      throw new NotFoundException(
        `Destination warehouse ${dto.destinationLocation} not found`,
      );
    }

    await this.prisma.inventoryLog.create({
      data: {
        productId: dto.productId,
        variantId: dto.variantId,
        quantity: dto.quantity,
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
