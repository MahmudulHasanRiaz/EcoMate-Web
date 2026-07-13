import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { CostingLotService } from '../stock/costing-lot.service';
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
    private readonly stockRouter: StockRouterService,
    private readonly costingLotService: CostingLotService,
    private readonly managedStockLedgerService: ManagedStockLedgerService,
  ) {}

  async lowStock() {
    const parseImages = (imgVal: any): string | null => {
      if (!imgVal) return null;
      if (typeof imgVal === 'string') {
        try {
          const parsed = JSON.parse(imgVal);
          return Array.isArray(parsed) && parsed.length ? parsed[0] : imgVal;
        } catch {
          return imgVal;
        }
      }
      if (Array.isArray(imgVal) && imgVal.length) {
        return imgVal[0];
      }
      return null;
    };

    const products = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        stock: number;
        lowStockQty: number | null;
        sku: string | null;
        images: any;
      }>
    >`
      SELECT id, name, slug, stock, "lowStockQty", sku, images
      FROM "Product"
      WHERE "availabilityMode" = 'MANAGED_STOCK'
        AND "isActive" = true
        AND "type" != 'variable'
        AND stock <= COALESCE("lowStockQty", 5)
      ORDER BY name ASC
    `;
    const lowStockProducts = products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      stock: p.stock,
      lowStockQty: p.lowStockQty,
      sku: p.sku,
      image: parseImages(p.images),
      type: 'product' as const,
    }));

    const variableProducts = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        sku: string | null;
        lowStockQty: number | null;
        images: any;
        variantId: string;
        variantSku: string | null;
        variantStock: number;
        variantImage: string | null;
        variantAttributes: string | null;
      }>
    >`
      SELECT
        p.id,
        p.name,
        p.slug,
        p.sku,
        p."lowStockQty",
        p.images,
        pv.id AS "variantId",
        pv.sku AS "variantSku",
        pv.stock AS "variantStock",
        pv.image AS "variantImage",
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
        AND p."type" = 'variable'
        AND p."availabilityMode" = 'MANAGED_STOCK'
        AND pv.stock <= COALESCE(p."lowStockQty", 5)
      ORDER BY p.name ASC
    `;
    const lowStockVariants = variableProducts.map((v) => ({
      id: v.variantId,
      name: v.name,
      slug: v.slug,
      stock: v.variantStock,
      lowStockQty: v.lowStockQty,
      sku: v.sku,
      image: v.variantImage || parseImages(v.images),
      type: 'variant' as const,
      variantSku: v.variantSku || '',
      variantAttributes: v.variantAttributes || v.variantSku || '',
    }));

    const allLowStock = [...lowStockProducts, ...lowStockVariants];
    return { products: allLowStock, count: allLowStock.length };
  }

  async physicalReplenishment() {
    // Products where physical available stock is at or below low stock threshold
    const sql = `
      SELECT
        p.id, p.name, p.sku, p."lowStockQty",
        SUM(pi.quantity) as physical_qty,
        SUM(pi."reservedQuantity") as reserved_qty,
        SUM(pi.quantity) - SUM(pi."reservedQuantity") as available,
        COALESCE(p."lowStockQty", 5) as threshold
      FROM "Product" p
      JOIN "PhysicalInventory" pi ON pi."productId" = p.id
      WHERE p."isActive" = true
      GROUP BY p.id, p.name, p.sku, p."lowStockQty"
      HAVING SUM(pi.quantity) - SUM(pi."reservedQuantity") <= COALESCE(p."lowStockQty", 5)
      ORDER BY p.name ASC
    `;
    const products = await this.prisma.$queryRawUnsafe<any[]>(sql);
    return { products, count: products.length };
  }

  async logs(page = 1, perPage = 20, type?: string, warehouseId?: string, productId?: string) {
    const where: any = {};
    if (type) {
      if (type === 'adjustment') {
        where.type = { in: ['adjustment', 'ADJUSTMENT', 'physical_adjustment', 'PHYSICAL_ADJUSTMENT'] };
      } else if (type === 'transfer') {
        where.type = { in: ['transfer', 'TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT'] };
      } else if (type === 'sale') {
        where.type = { in: ['sale', 'SALE', 'order_fulfilled', 'ORDER_FULFILLED'] };
      } else if (type === 'return') {
        where.type = { in: ['return', 'RETURN'] };
      } else {
        where.type = {
          mode: 'insensitive',
          equals: type,
        };
      }
    }
    if (warehouseId) {
      where.warehouseId = warehouseId;
    }
    if (productId) {
      where.productId = productId;
    }

    const [data, total] = await Promise.all([
      this.prisma.physicalInventoryLedger.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, images: true } },
          variant: {
            select: {
              id: true,
              sku: true,
              price: true,
              attributeValues: {
                include: {
                  attributeValue: {
                    select: { id: true, value: true, attribute: { select: { name: true } } },
                  },
                },
              },
            },
          },
          warehouse: { select: { id: true, name: true } },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.physicalInventoryLedger.count({ where }),
    ]);

    const mapped = data.map((l) => {
      const prodImages = l.product?.images;
      const firstImage = Array.isArray(prodImages) && prodImages.length ? prodImages[0] : null;
      const variantLabel = l.variant
        ? l.variant.attributeValues
            ?.map((av: any) => av.attributeValue?.value)
            .filter(Boolean)
            .join(' / ') || null
        : null;
      return {
        id: l.id,
        productId: l.productId,
        variantId: l.variantId,
        warehouseId: l.warehouseId,
        quantity: l.quantity,
        direction: l.direction,
        stockBefore: l.stockBefore,
        stockAfter: l.stockAfter,
        type: l.type.toLowerCase(),
        reason: l.reason,
        note: l.reason,
        performedBy: l.performedBy || 'System',
        performedAt: l.createdAt,
        productName: l.product?.name || '—',
        variantName: variantLabel,
        sku: l.variant?.sku || l.product?.sku || '—',
        warehouseName: l.warehouse?.name || null,
        image: typeof firstImage === 'string' ? firstImage : null,
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
        performedBy,
        ledgerType: ManagedStockMovementType.ADJUSTMENT,
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
              ledgerType: ManagedStockMovementType.ADJUSTMENT,
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

          if (isInventoryControlled && effectiveVariantId) {
            // Get product's warehouseId and call addPhysical
            const invProduct = await client.product.findUnique({
              where: { id: ci.productId },
              select: { warehouseId: true }
            });
            if (invProduct?.warehouseId) {
              await this.stockService.addPhysical({
                productId: ci.productId,
                variantId: effectiveVariantId,
                quantity: qty,
                warehouseId: invProduct.warehouseId,
                reference: `restock-${orderId}`,
                tx: tx || undefined,
              });
              // Restore cost for return
              await this.costingLotService.restoreForReturn({
                returnReferenceId: orderId,
                productId: ci.productId,
                variantId: effectiveVariantId,
                warehouseId: invProduct.warehouseId,
                returnQty: qty,
                tx: tx || undefined,
              });
            }
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

        if (isInventoryControlled && item.productId) {
          const invProduct = await client.product.findUnique({
            where: { id: item.productId },
            select: { warehouseId: true }
          });
          if (invProduct?.warehouseId) {
            await this.stockService.addPhysical({
              productId: item.productId,
              variantId: item.variantId ?? undefined,
              quantity: item.quantity,
              warehouseId: invProduct.warehouseId,
              reference: `restock-${orderId}`,
              tx: tx || undefined,
            });
            // Restore cost for return
            await this.costingLotService.restoreForReturn({
              returnReferenceId: orderId,
              productId: item.productId,
              variantId: item.variantId ?? null,
              warehouseId: invProduct.warehouseId,
              returnQty: item.quantity,
              tx: tx || undefined,
            });
          }
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
          reservedStock: true,
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
              reservedStock: true,
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

    const productIds = data.map((p) => p.id);
    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
    const physicalSums = imEnabled ? await this.prisma.physicalInventory.groupBy({
      by: ['productId'],
      _sum: {
        quantity: true,
        reservedQuantity: true,
      },
      where: {
        productId: { in: productIds },
      },
    }) : [];

    const sumMap = new Map(
      physicalSums.map((s) => [s.productId, s._sum.quantity ?? 0]),
    );

    const reservedSumMap = new Map(
      physicalSums.map((s) => [s.productId, s._sum.reservedQuantity ?? 0]),
    );

    const dataWithAvailableStock = data.map((p) => {
      const physicalStockSum = sumMap.get(p.id) ?? 0;
      const managedStockSum = p.type === 'variable'
        ? p.variants.reduce((sum, v) => sum + (v.managedStockQuantity ?? 0), 0)
        : p.managedStockQuantity;

      return {
        ...p,
        managedStockQuantity: managedStockSum,
        _physicalStock: physicalStockSum,
        availableStock:
          p.availabilityMode === 'MANAGED_STOCK'
            ? managedStockSum - (p.reservedStock ?? 0)
            : p.availabilityMode === 'INVENTORY_CONTROLLED'
              ? physicalStockSum - (reservedSumMap.get(p.id) ?? 0)
              : p.availabilityMode === 'ALWAYS_IN_STOCK'
                ? null
                : 0,
        variants: p.variants.map((v) => ({
          ...v,
          availableStock:
            p.availabilityMode === 'MANAGED_STOCK'
              ? v.managedStockQuantity - (v.reservedStock ?? 0)
              : p.availabilityMode === 'INVENTORY_CONTROLLED'
                ? physicalStockSum - (reservedSumMap.get(p.id) ?? 0)
                : p.availabilityMode === 'ALWAYS_IN_STOCK'
                  ? null
                  : 0,
        })),
      };
    });

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
    // Physical Inventory Valuation (FIFO CostingLot-based)
    // Returns per-product: physical_qty, lot_remaining_qty, fifo_value, reconciliation_status
    const whereConditions: string[] = ['p."isActive" = true'];
    const params: any[] = [];

    if (query.categoryId) {
      params.push(query.categoryId);
      whereConditions.push(`p."categoryId" = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      whereConditions.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')} AND`
      : 'WHERE';

    const sql = `
      WITH pi_agg AS (
        SELECT "productId", SUM(quantity) as total_qty, SUM("reservedQuantity") as total_reserved
        FROM "PhysicalInventory"
        GROUP BY "productId"
      ),
      cl_agg AS (
        SELECT "productId", SUM("remainingQty" * "unitCost") as fifo_value, SUM("remainingQty") as lot_qty
        FROM "CostingLot"
        WHERE "remainingQty" > 0
        GROUP BY "productId"
      )
      SELECT
        p.id, p.name, p.sku, p."standardCost",
        COALESCE(pi_agg.total_qty, 0) as physical_qty,
        COALESCE(pi_agg.total_reserved, 0) as physical_reserved,
        COALESCE(cl_agg.fifo_value, 0) as fifo_value,
        COALESCE(cl_agg.lot_qty, 0) as lot_qty,
        CASE
          WHEN COALESCE(pi_agg.total_qty, 0) != COALESCE(cl_agg.lot_qty, 0)
          THEN 'RECONCILIATION_NEEDED'
          ELSE 'OK'
        END as reconciliation_status
      FROM "Product" p
      LEFT JOIN pi_agg ON pi_agg."productId" = p.id
      LEFT JOIN cl_agg ON cl_agg."productId" = p.id
      ${whereClause} COALESCE(pi_agg.total_qty, 0) > 0
      ORDER BY p.name ASC
    `;

    const rows = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);

    let totalValue = 0;
    let totalPhysicalQty = 0;
    let totalLotQty = 0;
    const items: any[] = [];

    for (const row of rows) {
      const fifoValue = Number(row.fifo_value);
      totalValue += fifoValue;
      totalPhysicalQty += Number(row.physical_qty);
      totalLotQty += Number(row.lot_qty);
      items.push({
        id: row.id,
        type: 'product',
        name: row.name,
        sku: row.sku,
        physicalQty: Number(row.physical_qty),
        physicalReserved: Number(row.physical_reserved),
        lotRemainingQty: Number(row.lot_qty),
        unitCost: Number(row.standardCost) || 0,
        fifoValue,
        reconciliationStatus: row.reconciliation_status,
      });
    }

    return {
      items,
      totalValue,
      totalPhysicalQty,
      totalLotQty,
      count: items.length,
      type: 'physical_inventory_valuation',
    };
  }

  async managedStockValue(query: ValuationQueryDto) {
    // Managed Stock Value (lightweight, standardCost-based)
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
        standardCost: true,
        variants: {
          select: {
            id: true,
            sku: true,
            managedStockQuantity: true,
          },
        },
      },
    });

    let totalValue = 0;
    let totalStock = 0;
    const items: any[] = [];

    for (const product of products) {
      const cost = Number(product.standardCost) || 0;
      if (product.variants.length > 0) {
        for (const v of product.variants) {
          totalValue += cost * v.managedStockQuantity;
          totalStock += v.managedStockQuantity;
          items.push({
            id: v.id,
            type: 'variant',
            sku: v.sku,
            stock: v.managedStockQuantity,
            unitCost: cost,
            totalValue: cost * v.managedStockQuantity,
          });
        }
      } else {
        totalValue += cost * product.managedStockQuantity;
        totalStock += product.managedStockQuantity;
        items.push({
          id: product.id,
          type: 'product',
          name: product.name,
          sku: product.sku,
          stock: product.managedStockQuantity,
          unitCost: cost,
          totalValue: cost * product.managedStockQuantity,
        });
      }
    }

    return { items, totalValue, totalStock, count: items.length, type: 'managed_stock_value' };
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

    // Idempotency check
    const existing = await this.prisma.stockTransfer.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return existing;

    return this.prisma.$transaction(async (tx) => {
      // Create StockTransfer header
      const transfer = await tx.stockTransfer.create({
        data: {
          idempotencyKey: dto.idempotencyKey,
          sourceWarehouseId: dto.sourceLocation,
          destWarehouseId: dto.destinationLocation,
          status: 'IN_PROGRESS',
          notes: dto.notes,
          performedBy,
        },
      });

      // Deduct physical stock from source
      if (dto.sourceBinId) {
        await this.stockService.deductPhysical({
          productId: dto.productId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          warehouseId: dto.sourceLocation,
          binLocationId: dto.sourceBinId,
          reference: `Transfer ${transfer.id} to ${destWarehouse.name}`,
          performedBy,
          ledgerType: 'TRANSFER_OUT',
          tx,
        });
      } else {
        const eligible = await tx.physicalInventory.findMany({
          where: {
            productId: dto.productId,
            ...(dto.variantId && { variantId: dto.variantId }),
            warehouseId: dto.sourceLocation,
          },
          orderBy: { updatedAt: 'asc' },
        });

        let remaining = dto.quantity;
        for (const pi of eligible) {
          if (remaining <= 0) break;
          const available = pi.quantity - pi.reservedQuantity;
          if (available <= 0) continue;

          const deductQty = Math.min(remaining, available);
          await tx.physicalInventory.update({
            where: { id: pi.id },
            data: { quantity: { decrement: deductQty } },
          });

          await tx.physicalInventoryLedger.create({
            data: {
              productId: dto.productId,
              variantId: dto.variantId,
              warehouseId: dto.sourceLocation,
              quantity: deductQty,
              direction: 'OUT',
              stockBefore: pi.quantity,
              stockAfter: pi.quantity - deductQty,
              type: 'TRANSFER_OUT',
              reason: `Transfer ${transfer.id} to ${destWarehouse.name}`,
              performedBy,
            },
          });

          remaining -= deductQty;
        }

        if (remaining > 0) {
          throw new BadRequestException(
            `Insufficient stock for transfer. Requested: ${dto.quantity}, available: ${dto.quantity - remaining}`,
          );
        }
      }

      // Consume FIFO costing lots from source warehouse with exact lineage
      const consumedLots = await this.costingLotService.consumeFIFO({
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        warehouseId: dto.sourceLocation,
        quantity: dto.quantity,
        type: 'TRANSFER_OUT',
        referenceType: 'STOCK_TRANSFER',
        referenceId: transfer.id,
        tx,
      });

      // Create destination CostingLots with exact cost from source
      for (const consumed of consumedLots) {
        const sourceLot = await tx.costingLot.findUnique({
          where: { id: consumed.lotId },
        });
        const destLotNumber = `TRF-${transfer.id.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await tx.costingLot.create({
          data: {
            productId: dto.productId,
            variantId: dto.variantId,
            warehouseId: dto.destinationLocation,
            lotNumber: destLotNumber,
            unitCost: consumed.unitCost,
            totalCost: consumed.unitCost.mul(consumed.quantity),
            quantity: consumed.quantity,
            remainingQty: consumed.quantity,
            receivedAt: new Date(),
            transferId: transfer.id,
            sourceConsumptionId: (
              await tx.costingLotConsumption.findFirst({
                where: {
                  costingLotId: consumed.lotId,
                  type: 'TRANSFER_OUT',
                  referenceType: 'STOCK_TRANSFER',
                  referenceId: transfer.id,
                },
              })
            )?.id,
          },
        });
      }

      // Add physical stock to destination
      await this.stockService.addPhysical({
        productId: dto.productId,
        variantId: dto.variantId,
        quantity: dto.quantity,
        warehouseId: dto.destinationLocation,
        binLocationId: dto.destinationBinId,
        reference: `Transfer ${transfer.id} from ${sourceWarehouse.name}`,
        performedBy,
        ledgerType: 'TRANSFER_IN',
        tx,
      });

      await tx.inventoryLog.create({
        data: {
          productId: dto.productId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          type: 'transfer',
          reason: `Transferred ${dto.quantity} units from ${sourceWarehouse.name} to ${destWarehouse.name}${dto.notes ? ': ' + dto.notes : ''}`,
          performedBy,
        },
      });

      // Mark transfer complete
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      return {
        id: transfer.id,
        productId: product.id,
        productName: product.name,
        quantity: dto.quantity,
        source: dto.sourceLocation,
        destination: dto.destinationLocation,
      };
    });
  }
}
