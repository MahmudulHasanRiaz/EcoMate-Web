import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface StockOperationParams {
  productId?: string;
  variantId?: string;
  comboId?: string;
  comboSelection?: Record<string, string>;
  quantity: number;
  reference: string;
  performedBy?: string;
  unitCost?: number;
  tx?: Prisma.TransactionClient;
  warehouseId?: string;
}

interface StockTarget {
  productId: string;
  variantId: string | null;
  qty: number;
}

type StockOp = 'increment' | 'decrement';

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Prisma.TransactionClient) {
    if (tx) return tx;
    return this.prisma;
  }

  private async expandComboItems(
    comboId: string,
    quantity: number,
    comboSelection: Record<string, string> | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<StockTarget[]> {
    const combo = await tx.combo.findUnique({
      where: { id: comboId },
      include: { items: true },
    });
    if (!combo) throw new NotFoundException(`Combo ${comboId} not found`);
    return combo.items.map((ci) => {
      const effectiveVariantId =
        ci.variantId || comboSelection?.[ci.productId] || null;
      return {
        productId: ci.productId,
        variantId: effectiveVariantId,
        qty: ci.quantity * quantity,
      };
    });
  }

  private async lockRows(targets: StockTarget[], tx: Prisma.TransactionClient) {
    const productIds = [...new Set(targets.map((t) => t.productId))].sort();
    const variantIds = [
      ...new Set(targets.filter((t) => t.variantId).map((t) => t.variantId!)),
    ].sort();
    if (productIds.length > 0) {
      const ph = productIds.map((_, i) => `$${i + 1}`).join(', ');
      await tx.$queryRawUnsafe(
        `SELECT id FROM "Product" WHERE id IN (${ph}) FOR UPDATE`,
        ...productIds,
      );
    }
    if (variantIds.length > 0) {
      const vh = variantIds.map((_, i) => `$${i + 1}`).join(', ');
      await tx.$queryRawUnsafe(
        `SELECT id FROM "ProductVariant" WHERE id IN (${vh}) FOR UPDATE`,
        ...variantIds,
      );
    }
  }

  private async resolveTargets(
    params: StockOperationParams,
    tx: Prisma.TransactionClient,
  ): Promise<StockTarget[]> {
    if (params.comboId) {
      return this.expandComboItems(
        params.comboId,
        params.quantity,
        params.comboSelection,
        tx,
      );
    }
    if (params.variantId) {
      const v = await tx.productVariant.findUnique({
        where: { id: params.variantId },
        select: { productId: true },
      });
      if (!v)
        throw new NotFoundException(`Variant ${params.variantId} not found`);
      return [
        {
          productId: v.productId,
          variantId: params.variantId,
          qty: params.quantity,
        },
      ];
    }
    if (params.productId) {
      return [
        { productId: params.productId, variantId: null, qty: params.quantity },
      ];
    }
    throw new BadRequestException('productId, variantId, or comboId required');
  }

  private async applyStockChange(
    targets: StockTarget[],
    field: 'managedStockQuantity' | 'reservedStock',
    op: StockOp,
    tx: Prisma.TransactionClient,
  ) {
    const pIds = [...new Set(targets.map((t) => t.productId))];
    const vIds = [
      ...new Set(targets.filter((t) => t.variantId).map((t) => t.variantId!)),
    ];

    const products = await tx.product.findMany({
      where: { id: { in: pIds } },
      select: {
        id: true,
        type: true,
        manageStock: true,
        availabilityMode: true,
        managedStockQuantity: true,
        reservedStock: true,
      },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const variants =
      vIds.length > 0
        ? await tx.productVariant.findMany({
            where: { id: { in: vIds } },
            select: {
              id: true,
              managedStockQuantity: true,
              reservedStock: true,
              productId: true,
            },
          })
        : [];
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const adjust = async (
      model: 'product' | 'productVariant',
      id: string,
      f: string,
      qty: number,
    ) => {
      const opStr = op === 'increment' ? 'increment' : 'decrement';
      if (model === 'product') {
        await tx.product.update({
          where: { id },
          data: { [f]: { [opStr]: qty } },
        });
      } else {
        await tx.productVariant.update({
          where: { id },
          data: { [f]: { [opStr]: qty } },
        });
      }
    };

    const isManagedField = (p: { availabilityMode: string | null }) =>
      field !== 'managedStockQuantity' ||
      p.availabilityMode === 'MANAGED_STOCK' ||
      p.availabilityMode === null;

    for (const t of targets) {
      if (t.variantId) {
        const v = variantMap.get(t.variantId);
        if (!v)
          throw new BadRequestException(`Variant ${t.variantId} not found`);
        const p = productMap.get(t.productId);
        if (!isManagedField(p!)) continue;
        const avail =
          field === 'reservedStock'
            ? v.managedStockQuantity - v.reservedStock
            : v.managedStockQuantity;
        if (op === 'decrement' && avail < t.qty) {
          throw new BadRequestException(
            `Insufficient stock variant ${t.variantId}. Available: ${avail}, needed: ${t.qty}.`,
          );
        }
        await adjust('productVariant', t.variantId, field, t.qty);
        // Also update parent product stock if it manages stock
        if (p && p.manageStock && p.type === 'simple') {
          if (op === 'decrement' && Number(p[field]) < t.qty) {
            throw new BadRequestException(
              `Insufficient stock product ${t.productId}. Available: ${Number(p[field])}, needed: ${t.qty}.`,
            );
          }
          await adjust('product', t.productId, field, t.qty);
        }
      } else {
        const p = productMap.get(t.productId);
        if (!p)
          throw new BadRequestException(`Product ${t.productId} not found`);
        if (!isManagedField(p)) continue;
        const avail =
          field === 'reservedStock'
            ? p.managedStockQuantity - p.reservedStock
            : p.managedStockQuantity;
        if (op === 'decrement' && !p.manageStock) continue; // skip non-managed stock
        if (op === 'decrement' && avail < t.qty) {
          throw new BadRequestException(
            `Insufficient stock product ${t.productId}. Available: ${avail}, needed: ${t.qty}.`,
          );
        }
        await adjust('product', t.productId, field, t.qty);
      }
    }
  }

  private async deductCostingLots(
    targets: StockTarget[],
    tx: Prisma.TransactionClient,
  ) {
    for (const t of targets) {
      if (t.variantId) continue;
      const product = await tx.product.findUnique({
        where: { id: t.productId },
        select: { availabilityMode: true },
      });
      if (product && product.availabilityMode !== 'MANAGED_STOCK') continue;
      let remaining = t.qty;
      while (remaining > 0) {
        const lot = await tx.costingLot.findFirst({
          where: { productId: t.productId, remainingQty: { gt: 0 } },
          orderBy: { receivedAt: 'asc' },
        });
        if (!lot) {
          this.logger.warn(
            `No costing lot for product ${t.productId}, remaining ${remaining}`,
          );
          break;
        }
        const deduct = Math.min(remaining, lot.remainingQty);
        await tx.costingLot.update({
          where: { id: lot.id },
          data: { remainingQty: { decrement: deduct } },
        });
        remaining -= deduct;
      }
    }
  }

  private async logInventory(
    targets: StockTarget[],
    type: string,
    reason: string,
    performedBy: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    for (const t of targets) {
      await tx.inventoryLog.create({
        data: {
          productId: t.productId,
          variantId: t.variantId,
          quantity:
            type === 'scrap' || type === 'order_fulfilled' ? -t.qty : t.qty,
          type,
          reason,
          performedBy,
        },
      });
    }
  }

  private async logManagedStockLedger(
    targets: StockTarget[],
    direction: Prisma.$ManagedStockLedgerPayload['scalars']['direction'],
    type: Prisma.$ManagedStockLedgerPayload['scalars']['type'],
    referenceType: Prisma.$ManagedStockLedgerPayload['scalars']['referenceType'],
    referenceId: string | undefined,
    performedBy: string | undefined,
    note: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    for (const t of targets) {
      await tx.managedStockLedger.create({
        data: {
          productId: t.productId,
          variantId: t.variantId,
          comboId: null,
          quantity: t.qty,
          direction,
          type,
          stockBefore: null,
          stockAfter: null,
          referenceType,
          referenceId,
          reason: note,
          performedById: performedBy,
        },
      });
    }
  }

  private async applyPhysicalChange(
    targets: { productId: string; warehouseId: string; qty: number }[],
    op: 'increment' | 'decrement',
    field: 'quantity' | 'reservedQuantity',
    tx: Prisma.TransactionClient,
  ) {
    for (const t of targets) {
      const existing = await tx.physicalInventory.findUnique({
        where: {
          productId_warehouseId: {
            productId: t.productId,
            warehouseId: t.warehouseId,
          },
        },
      });
      if (!existing && field === 'quantity' && op === 'decrement') {
        throw new BadRequestException(
          `No physical inventory record for product ${t.productId} in warehouse ${t.warehouseId}`,
        );
      }
      await tx.physicalInventory.upsert({
        where: {
          productId_warehouseId: {
            productId: t.productId,
            warehouseId: t.warehouseId,
          },
        },
        create: {
          productId: t.productId,
          warehouseId: t.warehouseId,
          quantity: field === 'quantity' ? (op === 'increment' ? t.qty : 0) : 0,
          reservedQuantity:
            field === 'reservedQuantity' ? (op === 'increment' ? t.qty : 0) : 0,
        },
        update: { [field]: { [op]: t.qty } },
      });
    }
  }

  private async operatePhysical(
    operation: 'reserve' | 'release' | 'deduct' | 'add',
    params: StockOperationParams,
  ) {
    if (!params.warehouseId) {
      throw new BadRequestException(
        'warehouseId required for physical inventory operations',
      );
    }
    const exec = async (tx: Prisma.TransactionClient) => {
      const targets = await this.resolveTargets(params, tx);
      const physicalTargets = targets.map((t) => ({
        productId: t.productId,
        warehouseId: params.warehouseId!,
        qty: t.qty,
      }));

      if (operation === 'reserve') {
        await this.applyPhysicalChange(
          physicalTargets,
          'increment',
          'reservedQuantity',
          tx,
        );
      } else if (operation === 'release') {
        await this.applyPhysicalChange(
          physicalTargets,
          'decrement',
          'reservedQuantity',
          tx,
        );
      } else if (operation === 'deduct') {
        await this.applyPhysicalChange(
          physicalTargets,
          'decrement',
          'quantity',
          tx,
        );
        await this.applyPhysicalChange(
          physicalTargets,
          'decrement',
          'reservedQuantity',
          tx,
        );
      } else if (operation === 'add') {
        await this.applyPhysicalChange(
          physicalTargets,
          'increment',
          'quantity',
          tx,
        );
      }
      return targets;
    };

    if (params.tx) {
      return exec(params.tx);
    }
    return this.prisma.$transaction(exec);
  }

  async operate(
    operation: 'reserve' | 'release' | 'deduct' | 'add' | 'scrap',
    params: StockOperationParams,
  ) {
    const exec = async (tx: Prisma.TransactionClient) => {
      const targets = await this.resolveTargets(params, tx);
      await this.lockRows(targets, tx);

      if (operation === 'reserve') {
        await this.applyStockChange(targets, 'reservedStock', 'increment', tx);
        await this.logInventory(
          targets,
          'reserve',
          `Reserved for ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'IN',
          'ADJUSTMENT',
          'ORDER',
          params.reference,
          params.performedBy,
          `Reserved for ${params.reference}`,
          tx,
        );
      } else if (operation === 'release') {
        await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
        await this.logInventory(
          targets,
          'release',
          `Released for ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'OUT',
          'CANCEL_RELEASE',
          'ORDER',
          params.reference,
          params.performedBy,
          `Released for ${params.reference}`,
          tx,
        );
      } else if (operation === 'deduct') {
        await this.applyStockChange(
          targets,
          'managedStockQuantity',
          'decrement',
          tx,
        );
        await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
        await this.deductCostingLots(targets, tx);
        await this.logInventory(
          targets,
          'order_fulfilled',
          `Deducted for ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'OUT',
          'ORDER_DEDUCTION',
          'ORDER',
          params.reference,
          params.performedBy,
          `Deducted for ${params.reference}`,
          tx,
        );
      } else if (operation === 'add') {
        await this.applyStockChange(
          targets,
          'managedStockQuantity',
          'increment',
          tx,
        );
        await this.logInventory(
          targets,
          params.reference.startsWith('GRN-') ||
            params.reference.startsWith('PO-')
            ? 'purchase_receive'
            : 'manual_adjustment',
          `Added via ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'IN',
          'MANUAL_ADD',
          'MANUAL',
          params.reference,
          params.performedBy,
          `Added via ${params.reference}`,
          tx,
        );
      } else if (operation === 'scrap') {
        await this.applyStockChange(
          targets,
          'managedStockQuantity',
          'decrement',
          tx,
        );
        await this.logInventory(
          targets,
          'scrap',
          `Scrapped: ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'OUT',
          'MANUAL_REMOVE',
          'MANUAL',
          params.reference,
          params.performedBy,
          `Scrapped: ${params.reference}`,
          tx,
        );
      }
      return targets;
    };

    if (params.tx) {
      return exec(params.tx);
    }
    return this.prisma.$transaction(exec);
  }

  reserve(params: StockOperationParams) {
    return this.operate('reserve', params);
  }

  release(params: StockOperationParams) {
    return this.operate('release', params);
  }

  deduct(params: StockOperationParams) {
    return this.operate('deduct', params);
  }

  add(params: StockOperationParams) {
    return this.operate('add', params);
  }

  scrap(params: StockOperationParams) {
    return this.operate('scrap', params);
  }

  async getAvailableStock(productId: string, variantId?: string) {
    if (variantId) {
      const v = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { managedStockQuantity: true, reservedStock: true },
      });
      if (!v) throw new NotFoundException(`Variant ${variantId} not found`);
      return {
        stock: v.managedStockQuantity,
        reserved: v.reservedStock,
        available: v.managedStockQuantity - v.reservedStock,
      };
    }
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { managedStockQuantity: true, reservedStock: true },
    });
    if (!p) throw new NotFoundException(`Product ${productId} not found`);
    return {
      stock: p.managedStockQuantity,
      reserved: p.reservedStock,
      available: p.managedStockQuantity - p.reservedStock,
    };
  }

  async checkPhysicalAvailability(productId: string, warehouseId: string) {
    const inv = await this.prisma.physicalInventory.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
    });
    if (!inv) {
      return {
        available: false,
        currentStock: 0,
        reserved: 0,
        availableStock: 0,
      };
    }
    const availableStock = inv.quantity - inv.reservedQuantity;
    return {
      available: true,
      currentStock: inv.quantity,
      reserved: inv.reservedQuantity,
      availableStock,
    };
  }

  reservePhysical(params: StockOperationParams) {
    return this.operatePhysical('reserve', params);
  }

  releasePhysical(params: StockOperationParams) {
    return this.operatePhysical('release', params);
  }

  deductPhysical(params: StockOperationParams) {
    return this.operatePhysical('deduct', params);
  }

  addPhysical(params: StockOperationParams) {
    return this.operatePhysical('add', params);
  }

  async getTotalValuation() {
    const products = await this.prisma.product.findMany({
      where: { availabilityMode: 'MANAGED_STOCK' },
      select: {
        id: true,
        name: true,
        managedStockQuantity: true,
        basePrice: true,
        salePrice: true,
      },
    });
    const variants = await this.prisma.productVariant.findMany({
      where: { product: { availabilityMode: 'MANAGED_STOCK' } },
      select: {
        id: true,
        productId: true,
        managedStockQuantity: true,
        price: true,
        sku: true,
      },
    });

    let totalValue = 0;
    let totalStock = 0;
    const items: any[] = [];
    const productPriceMap = new Map(
      products.map((p) => [p.id, Number(p.salePrice || p.basePrice)]),
    );

    for (const v of variants) {
      const price = Number(v.price || productPriceMap.get(v.productId) || 0);
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
    for (const p of products) {
      const vCount = variants.filter((v) => v.productId === p.id).length;
      if (vCount === 0) {
        const price = productPriceMap.get(p.id) || 0;
        totalValue += price * p.managedStockQuantity;
        totalStock += p.managedStockQuantity;
        items.push({
          id: p.id,
          type: 'product',
          name: p.name,
          stock: p.managedStockQuantity,
          unitPrice: price,
          totalValue: price * p.managedStockQuantity,
        });
      }
    }
    return { items, totalValue, totalStock, count: items.length };
  }
}
