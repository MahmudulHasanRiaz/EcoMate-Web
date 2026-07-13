import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, CostingLotConsumptionType } from '@prisma/client';

@Injectable()
export class CostingLotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Warehouse-scoped FIFO deduction. Returns lots consumed in order.
   * Creates CostingLotConsumption records for each lot consumed.
   */
  async consumeFIFO(params: {
    productId: string;
    variantId: string | null;
    warehouseId: string;
    quantity: number;
    type: CostingLotConsumptionType;
    referenceType: string;
    referenceId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<{ lotId: string; quantity: number; unitCost: Prisma.Decimal }[]> {
    const client = params.tx ?? this.prisma;
    let remaining = params.quantity;
    const consumed: { lotId: string; quantity: number; unitCost: Prisma.Decimal }[] = [];

    while (remaining > 0) {
      const lot = await client.costingLot.findFirst({
        where: {
          productId: params.productId,
          variantId: params.variantId ?? null,
          warehouseId: params.warehouseId,
          remainingQty: { gt: 0 },
        },
        orderBy: { receivedAt: 'asc' },
      });

      if (!lot) {
        throw new BadRequestException(
          `Insufficient costing lots for product ${params.productId}` +
          (params.variantId ? ` variant ${params.variantId}` : '') +
          ` in warehouse ${params.warehouseId}. Remaining: ${remaining}`,
        );
      }

      const deductQty = Math.min(remaining, lot.remainingQty);

      await client.costingLot.update({
        where: { id: lot.id },
        data: { remainingQty: { decrement: deductQty } },
      });

      await client.costingLotConsumption.create({
        data: {
          costingLotId: lot.id,
          type: params.type,
          quantity: deductQty,
          unitCost: lot.unitCost,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
        },
      });

      consumed.push({
        lotId: lot.id,
        quantity: deductQty,
        unitCost: lot.unitCost,
      });

      remaining -= deductQty;
    }

    return consumed;
  }

  /**
   * Aggregate consume: multiple allocations from same lot are aggregated
   * into a single CostingLotConsumption record.
   */
  async consumeFIFOAggregated(params: {
    productId: string;
    variantId: string | null;
    warehouseId: string;
    quantity: number;
    type: CostingLotConsumptionType;
    referenceType: string;
    referenceId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<{ lotId: string; quantity: number; unitCost: Prisma.Decimal }[]> {
    const client = params.tx ?? this.prisma;
    let remaining = params.quantity;
    const consumed: { lotId: string; quantity: number; unitCost: Prisma.Decimal }[] = [];

    while (remaining > 0) {
      const lot = await client.costingLot.findFirst({
        where: {
          productId: params.productId,
          variantId: params.variantId ?? null,
          warehouseId: params.warehouseId,
          remainingQty: { gt: 0 },
        },
        orderBy: { receivedAt: 'asc' },
      });

      if (!lot) {
        throw new BadRequestException(
          `Insufficient costing lots for product ${params.productId}` +
          (params.variantId ? ` variant ${params.variantId}` : '') +
          ` in warehouse ${params.warehouseId}. Remaining: ${remaining}`,
        );
      }

      const deductQty = Math.min(remaining, lot.remainingQty);

      await client.costingLot.update({
        where: { id: lot.id },
        data: { remainingQty: { decrement: deductQty } },
      });

      // Check for existing consumption with same reference to aggregate
      const existing = await client.costingLotConsumption.findFirst({
        where: {
          costingLotId: lot.id,
          type: params.type,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
        },
      });

      if (existing) {
        await client.costingLotConsumption.update({
          where: { id: existing.id },
          data: { quantity: { increment: deductQty } },
        });
      } else {
        await client.costingLotConsumption.create({
          data: {
            costingLotId: lot.id,
            type: params.type,
            quantity: deductQty,
            unitCost: lot.unitCost,
            referenceType: params.referenceType,
            referenceId: params.referenceId,
          },
        });
      }

      consumed.push({
        lotId: lot.id,
        quantity: deductQty,
        unitCost: lot.unitCost,
      });

      remaining -= deductQty;
    }

    return consumed;
  }

  /**
   * Get remaining restorable quantity for a consumption record.
   * restorable = consumption.quantity - SUM(restorations.quantity)
   */
  async getRestorableQuantity(
    consumptionId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const consumption = await client.costingLotConsumption.findUnique({
      where: { id: consumptionId },
      include: { restorations: { select: { quantity: true } } },
    });
    if (!consumption) return 0;
    const restored = consumption.restorations.reduce((sum, r) => sum + r.quantity, 0);
    return consumption.quantity - restored;
  }

  /**
   * Restore cost for a return. Creates CostingLotRestoration records
   * and new CostingLots at original unit cost.
   *
   * Walks consumptions in reverse (newest first) to find restorable balance.
   * Fails if total restorable < returnQty.
   */
  async restoreForReturn(params: {
    returnReferenceId: string;
    productId: string;
    variantId: string | null;
    warehouseId: string;
    returnQty: number;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = params.tx ?? this.prisma;

    // Find all FULFILLMENT consumptions for this product/variant/warehouse, newest first
    const consumptions = await client.costingLotConsumption.findMany({
      where: {
        type: 'FULFILLMENT',
        referenceType: 'ORDER_ITEM',
        costingLot: {
          productId: params.productId,
          variantId: params.variantId ?? null,
          warehouseId: params.warehouseId,
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { restorations: { select: { quantity: true } } },
    });

    let returnRemaining = params.returnQty;
    const restorationBatches: {
      consumptionId: string;
      quantity: number;
      unitCost: Prisma.Decimal;
    }[] = [];

    for (const consumption of consumptions) {
      if (returnRemaining <= 0) break;
      const restored = consumption.restorations.reduce((sum, r) => sum + r.quantity, 0);
      const restorable = consumption.quantity - restored;
      if (restorable <= 0) continue;

      const toRestore = Math.min(returnRemaining, restorable);
      restorationBatches.push({
        consumptionId: consumption.id,
        quantity: toRestore,
        unitCost: consumption.unitCost,
      });
      returnRemaining -= toRestore;
    }

    if (returnRemaining > 0) {
      throw new BadRequestException(
        `Cannot restore cost for return: insufficient consumption history. ` +
        `Requested: ${params.returnQty}, available: ${params.returnQty - returnRemaining}`,
      );
    }

    // Create restoration records and new costing lots
    for (const batch of restorationBatches) {
      await client.costingLotRestoration.create({
        data: {
          consumptionId: batch.consumptionId,
          returnReferenceId: params.returnReferenceId,
          quantity: batch.quantity,
          unitCost: batch.unitCost,
        },
      });

      // Create new CostingLot at original unit cost for returned stock
      const lotNumber = `RET-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await client.costingLot.create({
        data: {
          productId: params.productId,
          variantId: params.variantId,
          warehouseId: params.warehouseId,
          lotNumber,
          unitCost: batch.unitCost,
          totalCost: batch.unitCost.mul(batch.quantity),
          quantity: batch.quantity,
          remainingQty: batch.quantity,
          receivedAt: new Date(),
        },
      });
    }
  }

  /**
   * Get consumption history for a product/variant/warehouse.
   * Used for return allocation UI.
   */
  async getConsumptionHistory(params: {
    productId: string;
    variantId?: string | null;
    warehouseId?: string;
  }) {
    const where: any = {
      type: 'FULFILLMENT',
      referenceType: 'ORDER_ITEM',
    };
    if (params.productId) {
      where.costingLot = {
        productId: params.productId,
        ...(params.variantId !== undefined && { variantId: params.variantId ?? null }),
        ...(params.warehouseId && { warehouseId: params.warehouseId }),
      };
    }

    return this.prisma.costingLotConsumption.findMany({
      where,
      include: {
        costingLot: {
          select: { productId: true, variantId: true, warehouseId: true, lotNumber: true },
        },
        restorations: { select: { quantity: true, returnReferenceId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get valuation for a warehouse (or all warehouses).
   * Returns cost-weighted stock value per product/variant.
   */
  async getValuation(warehouseId?: string) {
    const where: any = { remainingQty: { gt: 0 } };
    if (warehouseId) where.warehouseId = warehouseId;

    const lots = await this.prisma.costingLot.findMany({
      where,
      select: {
        productId: true,
        variantId: true,
        warehouseId: true,
        unitCost: true,
        remainingQty: true,
        totalCost: true,
      },
    });

    // Aggregate by product/variant/warehouse
    const map = new Map<string, {
      productId: string;
      variantId: string | null;
      warehouseId: string;
      totalQty: number;
      totalValue: number;
      weightedUnitCost: number;
    }>();

    for (const lot of lots) {
      const key = `${lot.productId}|${lot.variantId}|${lot.warehouseId}`;
      const existing = map.get(key);
      const lotValue = Number(lot.unitCost) * lot.remainingQty;
      if (existing) {
        existing.totalQty += lot.remainingQty;
        existing.totalValue += lotValue;
        existing.weightedUnitCost = existing.totalValue / existing.totalQty;
      } else {
        map.set(key, {
          productId: lot.productId,
          variantId: lot.variantId,
          warehouseId: lot.warehouseId,
          totalQty: lot.remainingQty,
          totalValue: lotValue,
          weightedUnitCost: Number(lot.unitCost),
        });
      }
    }

    return Array.from(map.values());
  }
}
