import {
  Injectable, BadRequestException, NotFoundException, Logger,
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

  private async lockRows(
    targets: StockTarget[],
    tx: Prisma.TransactionClient,
  ) {
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
      if (!v) throw new NotFoundException(`Variant ${params.variantId} not found`);
      return [{ productId: v.productId, variantId: params.variantId, qty: params.quantity }];
    }
    if (params.productId) {
      return [{ productId: params.productId, variantId: null, qty: params.quantity }];
    }
    throw new BadRequestException('productId, variantId, or comboId required');
  }

  private async applyStockChange(
    targets: StockTarget[],
    field: 'stock' | 'reservedStock',
    op: StockOp,
    tx: Prisma.TransactionClient,
  ) {
    const pIds = [...new Set(targets.map((t) => t.productId))];
    const vIds = [...new Set(targets.filter((t) => t.variantId).map((t) => t.variantId!))];

    const products = await tx.product.findMany({
      where: { id: { in: pIds } },
      select: { id: true, type: true, manageStock: true, stock: true, reservedStock: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const variants = vIds.length > 0
      ? await tx.productVariant.findMany({
          where: { id: { in: vIds } },
          select: { id: true, stock: true, reservedStock: true, productId: true },
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
        await tx.product.update({ where: { id }, data: { [f]: { [opStr]: qty } } });
      } else {
        await tx.productVariant.update({ where: { id }, data: { [f]: { [opStr]: qty } } });
      }
    };

    for (const t of targets) {
      if (t.variantId) {
        const v = variantMap.get(t.variantId);
        if (!v) throw new BadRequestException(`Variant ${t.variantId} not found`);
        const avail = field === 'reservedStock' ? v.stock - v.reservedStock : v.stock;
        if (op === 'decrement' && avail < t.qty) {
          throw new BadRequestException(
            `Insufficient stock variant ${t.variantId}. Available: ${avail}, needed: ${t.qty}.`,
          );
        }
        await adjust('productVariant', t.variantId, field, t.qty);
        // Also update parent product stock if it manages stock
        const p = productMap.get(t.productId);
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
        if (!p) throw new BadRequestException(`Product ${t.productId} not found`);
        const avail = field === 'reservedStock' ? p.stock - p.reservedStock : p.stock;
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
      let remaining = t.qty;
      while (remaining > 0) {
        const lot = await tx.costingLot.findFirst({
          where: { productId: t.productId, remainingQty: { gt: 0 } },
          orderBy: { receivedAt: 'asc' },
        });
        if (!lot) {
          this.logger.warn(`No costing lot for product ${t.productId}, remaining ${remaining}`);
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
          quantity: type === 'scrap' || type === 'order_fulfilled' ? -t.qty : t.qty,
          type,
          reason,
          performedBy,
        },
      });
    }
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
        await this.logInventory(targets, 'reserve', `Reserved for ${params.reference}`, params.performedBy, tx);
      } else if (operation === 'release') {
        await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
        await this.logInventory(targets, 'release', `Released for ${params.reference}`, params.performedBy, tx);
      } else if (operation === 'deduct') {
        await this.applyStockChange(targets, 'stock', 'decrement', tx);
        await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
        if (!params.comboId) {
          await this.deductCostingLots(targets, tx);
        }
        await this.logInventory(targets, 'order_fulfilled', `Deducted for ${params.reference}`, params.performedBy, tx);
      } else if (operation === 'add') {
        await this.applyStockChange(targets, 'stock', 'increment', tx);
        await this.logInventory(
          targets,
          params.reference.startsWith('GRN-') || params.reference.startsWith('PO-') ? 'purchase_receive' : 'manual_adjustment',
          `Added via ${params.reference}`,
          params.performedBy,
          tx,
        );
      } else if (operation === 'scrap') {
        await this.applyStockChange(targets, 'stock', 'decrement', tx);
        await this.logInventory(targets, 'scrap', `Scrapped: ${params.reference}`, params.performedBy, tx);
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
        select: { stock: true, reservedStock: true },
      });
      if (!v) throw new NotFoundException(`Variant ${variantId} not found`);
      return { stock: v.stock, reserved: v.reservedStock, available: v.stock - v.reservedStock };
    }
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { stock: true, reservedStock: true },
    });
    if (!p) throw new NotFoundException(`Product ${productId} not found`);
    return { stock: p.stock, reserved: p.reservedStock, available: p.stock - p.reservedStock };
  }

  async getTotalValuation() {
    const products = await this.prisma.product.findMany({
      where: { manageStock: true },
      select: { id: true, name: true, stock: true, basePrice: true, salePrice: true },
    });
    const variants = await this.prisma.productVariant.findMany({
      where: { product: { manageStock: true } },
      select: { id: true, productId: true, stock: true, price: true, sku: true },
    });

    let totalValue = 0;
    let totalStock = 0;
    const items: any[] = [];
    const productPriceMap = new Map(products.map((p) => [p.id, Number(p.salePrice || p.basePrice)]));

    for (const v of variants) {
      const price = Number(v.price || productPriceMap.get(v.productId) || 0);
      totalValue += price * v.stock;
      totalStock += v.stock;
      items.push({ id: v.id, type: 'variant', sku: v.sku, stock: v.stock, unitPrice: price, totalValue: price * v.stock });
    }
    for (const p of products) {
      const vCount = variants.filter((v) => v.productId === p.id).length;
      if (vCount === 0) {
        const price = productPriceMap.get(p.id) || 0;
        totalValue += price * p.stock;
        totalStock += p.stock;
        items.push({ id: p.id, type: 'product', name: p.name, stock: p.stock, unitPrice: price, totalValue: price * p.stock });
      }
    }
    return { items, totalValue, totalStock, count: items.length };
  }
}
