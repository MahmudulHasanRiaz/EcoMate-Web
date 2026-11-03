import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, CostingLotConsumptionType } from '@prisma/client';

/**
 * The costing lots at a location do not cover the requested movement.
 *
 * Distinguished from a plain BadRequestException so a caller can tell a COST
 * problem (no cost basis for the movement) apart from a STOCK problem (not
 * enough units), and react differently — e.g. a transfer marks the movement
 * PARTIAL instead of treating it as an ordinary validation failure.
 */
export class CostingLotShortfallError extends BadRequestException {
  readonly productId: string;
  readonly variantId: string | null;
  readonly warehouseId: string;
  readonly requested: number;
  readonly consumed: number;
  readonly shortfall: number;
  readonly referenceType: string;
  readonly referenceId: string;

  constructor(details: {
    productId: string;
    variantId: string | null;
    warehouseId: string;
    requested: number;
    consumed: number;
    shortfall: number;
    referenceType: string;
    referenceId: string;
    type: CostingLotConsumptionType;
  }) {
    super(
      `Insufficient costing lots for product ${details.productId}` +
        `${details.variantId ? ` variant ${details.variantId}` : ''} at warehouse ${details.warehouseId}: ` +
        `requested ${details.requested}, costed ${details.consumed}, ` +
        `${details.shortfall} unit(s) have no cost basis. ` +
        `Reference ${details.referenceType}:${details.referenceId}. ` +
        `Receive or re-cost the missing quantity before moving stock.`,
    );
    this.name = 'CostingLotShortfallError';
    this.productId = details.productId;
    this.variantId = details.variantId;
    this.warehouseId = details.warehouseId;
    this.requested = details.requested;
    this.consumed = details.consumed;
    this.shortfall = details.shortfall;
    this.referenceType = details.referenceType;
    this.referenceId = details.referenceId;
  }
}

@Injectable()
export class CostingLotService {
  private readonly logger = new Logger(CostingLotService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Warehouse-scoped FIFO deduction. Returns lots consumed in order.
   * Creates CostingLotConsumption records for each lot consumed.
   *
   * THROWS on a shortfall. A partial consumption means part of the movement has
   * NO cost basis: stock has moved but its valuation has not, so any caller that
   * continued would complete the movement with understated valuation. Failing
   * loudly lets the caller's transaction roll the movement back (or mark the
   * movement partial) instead of silently losing cost lineage. Pass
   * `allowShortfall: true` only for callers that deliberately tolerate a
   * movement without cost basis.
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
    allowShortfall?: boolean;
  }): Promise<{ lotId: string; quantity: number; unitCost: Prisma.Decimal }[]> {
    const client = params.tx ?? this.prisma;
    let remaining = params.quantity;
    const consumed: { lotId: string; quantity: number; unitCost: Prisma.Decimal }[] = [];
    const skippedLotIds: string[] = [];

    while (remaining > 0) {
      const lot = await client.costingLot.findFirst({
        where: {
          productId: params.productId,
          variantId: params.variantId ?? null,
          warehouseId: params.warehouseId,
          remainingQty: { gt: 0 },
          ...(skippedLotIds.length ? { id: { notIn: skippedLotIds } } : {}),
        },
        // FIFO: oldest receipt first; createdAt breaks ties between lots
        // received in the same instant so consumption order is deterministic.
        orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      });

      if (!lot) {
        this.logShortfall(params, remaining, skippedLotIds.length);
        if (!params.allowShortfall) {
          throw new CostingLotShortfallError({
            productId: params.productId,
            variantId: params.variantId ?? null,
            warehouseId: params.warehouseId,
            requested: params.quantity,
            consumed: params.quantity - remaining,
            shortfall: remaining,
            referenceType: params.referenceType,
            referenceId: params.referenceId,
            type: params.type,
          });
        }
        break;
      }

      const deductQty = Math.min(remaining, lot.remainingQty);

      // Guarded decrement: a concurrent consumer that drained this lot between
      // the read above and this write can never drive remainingQty negative.
      const claim = await client.costingLot.updateMany({
        where: { id: lot.id, remainingQty: { gte: deductQty } },
        data: { remainingQty: { decrement: deductQty } },
      });
      if (claim.count === 0) {
        skippedLotIds.push(lot.id);
        continue;
      }

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
    const skippedLotIds: string[] = [];

    while (remaining > 0) {
      const lot = await client.costingLot.findFirst({
        where: {
          productId: params.productId,
          variantId: params.variantId ?? null,
          warehouseId: params.warehouseId,
          remainingQty: { gt: 0 },
          ...(skippedLotIds.length ? { id: { notIn: skippedLotIds } } : {}),
        },
        // FIFO: oldest receipt first; createdAt breaks ties between lots
        // received in the same instant so consumption order is deterministic.
        orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      });

      if (!lot) {
        this.logShortfall(params, remaining, skippedLotIds.length);
        break;
      }

      const deductQty = Math.min(remaining, lot.remainingQty);

      // Guarded decrement (see consumeFIFO): never negative under a race.
      const claim = await client.costingLot.updateMany({
        where: { id: lot.id, remainingQty: { gte: deductQty } },
        data: { remainingQty: { decrement: deductQty } },
      });
      if (claim.count === 0) {
        skippedLotIds.push(lot.id);
        continue;
      }

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
   * A costing-lot shortfall means part of the movement has NO cost basis
   * (valuation/reporting will drift). It must never be a silent console.warn:
   * log it with the full reference at error level.
   */
  private logShortfall(
    params: {
      productId: string;
      variantId: string | null;
      warehouseId: string;
      quantity: number;
      type: CostingLotConsumptionType;
      referenceType: string;
      referenceId: string;
    },
    remaining: number,
    racedLots: number,
  ): void {
    const consumedQty =
      Math.round((params.quantity - remaining) * 10000) / 10000;
    this.logger.error(
      `Insufficient costing lots — product ${params.productId} (variant ${params.variantId ?? 'n/a'}) ` +
        `at warehouse ${params.warehouseId}: requested ${params.quantity}, consumed ${consumedQty}, ` +
        `shortfall ${remaining}. Reference ${params.referenceType}:${params.referenceId} (${params.type})` +
        (racedLots > 0
          ? `; ${racedLots} lot(s) were being consumed concurrently.`
          : '.'),
    );
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
   *
   * Idempotent per returnReferenceId: restorations already recorded under
   * the same reference count toward returnQty, so a duplicate call is a
   * no-op and a call interrupted mid-way resumes for the remainder only
   * (the existing restoration row is topped up — @@unique([consumptionId,
   * returnReferenceId]) forbids a second row). When the caller supplies the
   * returned order's own identifiers (orderItemIds and/or cycleId), that
   * order's consumptions are restored from FIRST — the exact cost basis of
   * the units that actually went out — and the general pool is only touched
   * for any remainder.
   */
  async restoreForReturn(params: {
    returnReferenceId: string;
    productId: string;
    variantId: string | null;
    warehouseId: string;
    returnQty: number;
    orderItemIds?: string[];
    cycleId?: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = params.tx ?? this.prisma;
    const lotScope = {
      productId: params.productId,
      variantId: params.variantId ?? null,
      warehouseId: params.warehouseId,
    };

    // Idempotency: what has THIS return reference already restored (within
    // this product/variant/warehouse scope)?
    const priorForRef = await client.costingLotRestoration.findMany({
      where: {
        returnReferenceId: params.returnReferenceId,
        consumption: {
          type: 'FULFILLMENT',
          referenceType: 'ORDER_ITEM',
          costingLot: lotScope,
        },
      },
      select: { id: true, consumptionId: true, quantity: true },
    });
    const alreadyRestored = priorForRef.reduce((sum, r) => sum + r.quantity, 0);
    let returnRemaining = params.returnQty - alreadyRestored;
    if (returnRemaining <= 0) return; // duplicate call — nothing left to do
    const priorByConsumption = new Map(
      priorForRef.map((r) => [r.consumptionId, r]),
    );

    // Find all FULFILLMENT consumptions for this product/variant/warehouse, newest first
    const consumptions = await client.costingLotConsumption.findMany({
      where: {
        type: 'FULFILLMENT',
        referenceType: 'ORDER_ITEM',
        costingLot: lotScope,
      },
      orderBy: { createdAt: 'desc' },
      include: { restorations: { select: { quantity: true } } },
    });

    // Prefer the returned order's OWN consumptions (exact cost basis);
    // stable partition keeps newest-first order inside each group.
    const ownItemIds = new Set(params.orderItemIds ?? []);
    const isOwn = (c: { referenceId: string; cycleId: string | null }) =>
      ownItemIds.has(c.referenceId) ||
      (params.cycleId != null && c.cycleId === params.cycleId);
    const ordered =
      ownItemIds.size > 0 || params.cycleId != null
        ? [
            ...consumptions.filter(isOwn),
            ...consumptions.filter((c) => !isOwn(c)),
          ]
        : consumptions;

    const restorationBatches: {
      consumptionId: string;
      quantity: number;
      unitCost: Prisma.Decimal;
      existingRestorationId?: string;
    }[] = [];

    for (const consumption of ordered) {
      if (returnRemaining <= 0) break;
      const restored = consumption.restorations.reduce((sum, r) => sum + r.quantity, 0);
      const restorable = consumption.quantity - restored;
      if (restorable <= 0) continue;

      const toRestore = Math.min(returnRemaining, restorable);
      restorationBatches.push({
        consumptionId: consumption.id,
        quantity: toRestore,
        unitCost: consumption.unitCost,
        existingRestorationId: priorByConsumption.get(consumption.id)?.id,
      });
      returnRemaining -= toRestore;
    }

    if (returnRemaining > 0) {
      throw new BadRequestException(
        `Cannot restore cost for return: insufficient consumption history. ` +
        `Requested: ${params.returnQty}, available: ${params.returnQty - returnRemaining}`,
      );
    }

    // Create restoration records and new costing lots. A consumption already
    // restored under this same reference (interrupted earlier call) is
    // topped up in place instead of duplicated.
    for (const batch of restorationBatches) {
      if (batch.existingRestorationId) {
        await client.costingLotRestoration.update({
          where: { id: batch.existingRestorationId },
          data: { quantity: { increment: batch.quantity } },
        });
      } else {
        await client.costingLotRestoration.create({
          data: {
            consumptionId: batch.consumptionId,
            returnReferenceId: params.returnReferenceId,
            quantity: batch.quantity,
            unitCost: batch.unitCost,
          },
        });
      }

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
