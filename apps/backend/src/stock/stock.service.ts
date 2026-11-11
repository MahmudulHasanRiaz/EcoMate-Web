import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ReferenceEntity } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { CostingLotService } from './costing-lot.service';

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
  ledgerType?: string;
  binLocationId?: string;
  referenceType?: ReferenceEntity;
  referenceId?: string;
  skipCostingLotDeduct?: boolean;
  /**
   * Reservation-awareness for `deductPhysical`.
   *
   * A deduction that CONSUMES a reservation (a dispatched order, reservation
   * fulfilled) must also release that hold, so `reservedQuantity` is
   * decremented alongside `quantity` — the default.
   *
   * A deduction that never reserved anything (a warehouse TRANSFER moving
   * already-available stock) must NOT touch `reservedQuantity`: nothing was
   * held, so the decrement would only drive it negative and inflate the
   * available quantity that the stock router reads. Set this to true for
   * those callers.
   *
   * Equivalent to the legacy `isNegative` behaviour (a negative-quantity
   * deduction, i.e. a manual removal).
   */
  consumesReservation?: boolean;
}

/** A single PhysicalInventory row an operation reads or writes. */
export interface PhysicalTarget {
  productId: string;
  variantId?: string | null;
  warehouseId: string;
  qty: number;
  binLocationId?: string;
}

/**
 * The observed state of the PhysicalInventory row an operation changed, and
 * the ledger leg that describes it. Produced by applyPhysicalChange so the
 * ledger can never disagree with the row that was really updated.
 */
export interface PhysicalChangeSnapshot {
  physicalInventoryId: string;
  productId: string;
  variantId: string | null;
  binLocationId: string | null;
  /** quantity + reservedQuantity as the row read them, before the change. */
  before: { quantity: number; reservedQuantity: number };
  /** The same pair after the change — null when the row was created. */
  after: { quantity: number; reservedQuantity: number } | null;
  /** How much this call moved on this field. */
  moved: number;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly costingLotService: CostingLotService,
  ) {}

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
        `SELECT id FROM "Product" WHERE id::text IN (${ph}) FOR UPDATE`,
        ...productIds,
      );
    }
    if (variantIds.length > 0) {
      const vh = variantIds.map((_, i) => `$${i + 1}`).join(', ');
      await tx.$queryRawUnsafe(
        `SELECT id FROM "ProductVariant" WHERE id::text IN (${vh}) FOR UPDATE`,
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

  /**
   * Apply one managed-counter move (on-hand or reserved) to every target.
   *
   * Returns the set of target keys (`productId|variantId`) whose counters
   * ACTUALLY moved, so callers can write ledger rows only for real legs —
   * a skipped leg must never produce a fabricated ledger entry.
   *
   * A product's managed leg applies only when the managed engine governs it:
   * MANAGED_STOCK (or legacy null mode). INVENTORY_CONTROLLED products
   * NEVER move the managed counters — not even with syncManagedStock=true
   * (owner decision 2026-11-11: auto-mirroring removed entirely; this
   * direct-operate guard is the second line of defence behind the
   * router, which now returns ms='skip' for every IC operation). For any
   * other product the managed leg is a complete no-op — no state change —
   * because its stock lives in the physical layer (or is not tracked).
   *
   * `guardAgainstReserved` (scrap): a managedStockQuantity decrement may
   * only consume UNRESERVED on-hand — reserved units belong to open orders
   * and cannot be scrapped out from under them.
   */
  private async applyStockChange(
    targets: StockTarget[],
    field: 'managedStockQuantity' | 'reservedStock',
    op: StockOp,
    tx: Prisma.TransactionClient,
    opts?: { guardAgainstReserved?: boolean },
  ): Promise<Set<string>> {
    const moved = new Set<string>();
    const targetKey = (t: StockTarget) => `${t.productId}|${t.variantId ?? ''}`;
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
        syncManagedStock: true,
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

    const managedLegApplies = (p: {
      availabilityMode: string | null;
      syncManagedStock: boolean;
    }) =>
      p.availabilityMode === 'MANAGED_STOCK' ||
      p.availabilityMode === null;

    // Available units for the move being attempted. A reservation can only
    // claim UNRESERVED on-hand; a release can only give back what is held;
    // a plain on-hand decrement is bounded by on-hand (or, for scrap, by
    // unreserved on-hand).
    const availableFor = (
      onHand: number,
      reserved: number,
    ): number => {
      if (field === 'reservedStock') {
        return op === 'increment' ? onHand - reserved : reserved;
      }
      if (op === 'decrement' && opts?.guardAgainstReserved) {
        return onHand - reserved;
      }
      return onHand;
    };

    for (const t of targets) {
      if (t.variantId) {
        const v = variantMap.get(t.variantId);
        if (!v)
          throw new BadRequestException(`Variant ${t.variantId} not found`);
        const p = productMap.get(t.productId);
        if (!p || !managedLegApplies(p)) continue;
        const avail = availableFor(v.managedStockQuantity, v.reservedStock);
        if (op === 'decrement' && avail < t.qty) {
          throw new BadRequestException(
            `Insufficient stock variant ${t.variantId}. Available: ${avail}, needed: ${t.qty}.`,
          );
        }
        // Reserve guard: never hold more than the unreserved on-hand. The
        // decrement side has always thrown on over-draw; the increment side
        // silently inflated reservedStock past the physical quantity, which
        // is how a managed reservation could oversell the product. Products
        // that do not track stock (manageStock=false) are exempt — their
        // counters are flag-only and reservations must keep working.
        if (
          op === 'increment' &&
          field === 'reservedStock' &&
          p.manageStock &&
          avail < t.qty
        ) {
          throw new BadRequestException(
            `Insufficient stock variant ${t.variantId}. Available: ${avail}, needed: ${t.qty}.`,
          );
        }
        await adjust('productVariant', t.variantId, field, t.qty);
        moved.add(targetKey(t));
        // Also update parent product stock if it manages stock
        if (p.manageStock && p.type === 'simple') {
          const pAvail = availableFor(
            Number(p.managedStockQuantity),
            Number(p.reservedStock),
          );
          if (op === 'decrement' && pAvail < t.qty) {
            throw new BadRequestException(
              `Insufficient stock product ${t.productId}. Available: ${pAvail}, needed: ${t.qty}.`,
            );
          }
          if (
            op === 'increment' &&
            field === 'reservedStock' &&
            pAvail < t.qty
          ) {
            throw new BadRequestException(
              `Insufficient stock product ${t.productId}. Available: ${pAvail}, needed: ${t.qty}.`,
            );
          }
          await adjust('product', t.productId, field, t.qty);
        }
      } else {
        const p = productMap.get(t.productId);
        if (!p)
          throw new BadRequestException(`Product ${t.productId} not found`);
        if (!managedLegApplies(p)) continue;
        const avail = availableFor(p.managedStockQuantity, p.reservedStock);
        if (op === 'decrement' && !p.manageStock) continue; // skip non-managed stock
        if (op === 'decrement' && avail < t.qty) {
          throw new BadRequestException(
            `Insufficient stock product ${t.productId}. Available: ${avail}, needed: ${t.qty}.`,
          );
        }
        if (
          op === 'increment' &&
          field === 'reservedStock' &&
          p.manageStock &&
          avail < t.qty
        ) {
          throw new BadRequestException(
            `Insufficient stock product ${t.productId}. Available: ${avail}, needed: ${t.qty}.`,
          );
        }
        await adjust('product', t.productId, field, t.qty);
        moved.add(targetKey(t));
      }
    }
    return moved;
  }

  /**
   * Cost a managed deduction through the costing-lot FIFO.
   *
   * The legacy implementation consumed the OLDEST lot of the product across
   * ALL warehouses, skipped variant targets entirely, wrote no consumption
   * records, and silently stopped at the first warehouse gap (warn + break)
   * — cost silently leaked between warehouses and left no audit trail.
   *
   * Now delegated to CostingLotService.consumeFIFO, which is scoped by
   * product + variant + warehouse, claims each lot with a guarded
   * updateMany, and writes one CostingLotConsumption row per lot. The
   * warehouse is the operation's warehouse when the caller supplies one,
   * else the product's home warehouse, else the warehouse holding the
   * product's physical stock.
   *
   * Shortfall policy: consumeFIFO is called with allowShortfall — a shortfall
   * is logged at ERROR level with the full reference (never a buried warn),
   * but it does not roll back the stock movement. Managed stock can
   * legitimately exist without lots (manual managed adjustments and seeded
   * stock create none), so hard-failing the deduction would newly block
   * dispatches that work today.
   */
  private async deductCostingLots(
    targets: StockTarget[],
    params: StockOperationParams,
    tx: Prisma.TransactionClient,
  ) {
    // One reference per operate() call: the caller's reference keeps the
    // consumption rows traceable, the suffix keeps the (referenceType,
    // referenceId, costingLotId, type) unique key collision-free across
    // repeated deductions for the same order.
    const referenceId = `${params.reference}#${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    for (const t of targets) {
      let warehouseId = params.warehouseId ?? null;
      if (!warehouseId) {
        const product = await tx.product.findUnique({
          where: { id: t.productId },
          select: { warehouseId: true },
        });
        warehouseId = product?.warehouseId ?? null;
      }
      if (!warehouseId) {
        const firstStock = await tx.physicalInventory.findFirst({
          where: { productId: t.productId, variantId: t.variantId },
          select: { warehouseId: true },
        });
        warehouseId = firstStock?.warehouseId ?? null;
      }
      if (!warehouseId) {
        this.logger.error(
          `Cannot cost deduction for product ${t.productId}: no warehouse resolvable ` +
            `(reference ${params.reference}); skipping costing for this target.`,
        );
        continue;
      }
      await this.costingLotService.consumeFIFO({
        productId: t.productId,
        variantId: t.variantId,
        warehouseId,
        quantity: t.qty,
        type: 'FULFILLMENT',
        referenceType: 'STOCK_DEDUCT',
        referenceId,
        tx,
        allowShortfall: true,
      });
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

  /**
   * Write one ledger leg per PhysicalInventory row that actually changed.
   *
   * The before/after pairs come from the change snapshots produced by
   * applyPhysicalChange, so the ledger can never disagree with the row that was
   * really updated — the old code re-queried with a `findFirst` that could land
   * on a different row (and forced binLocationId to null whenever the request
   * carried no bin). The snapshot's bin is the row's real bin.
   *
   * When one call touched a row twice (a reservation-consuming `deduct`
   * decrements quantity and then reservedQuantity) the snapshots are folded
   * into ONE leg: the before pair comes from the FIRST write and the after
   * pair from the LAST, so stockBefore/stockAfter describe the whole movement
   * instead of double-counting the reserved-only write into the quantity.
   */
  private async logPhysicalInventoryLedger(params: {
    snapshots: PhysicalChangeSnapshot[];
    warehouseId: string;
    direction: Prisma.$PhysicalInventoryLedgerPayload['scalars']['direction'];
    type: string;
    reference: string;
    performedBy: string | undefined;
    unitCost?: number;
    tx: Prisma.TransactionClient;
  }) {
    const { tx } = params;

    // Fold the per-call snapshots: several applyPhysicalChange calls (quantity
    // then reservedQuantity) hit the same row and must yield ONE ledger leg.
    const merged = new Map<
      string,
      PhysicalChangeSnapshot & { firstAt: number }
    >();
    params.snapshots.forEach((snap, idx) => {
      const key = `${snap.physicalInventoryId}|${snap.productId}|${snap.variantId ?? ''}`;
      const existing = merged.get(key);
      if (existing) {
        // `moved` is NOT summed: the second write moved reservedQuantity, and
        // the leg's quantity already covers the whole movement. Summing it
        // would report 2× the quantity for a reservation-consuming deduction.
        // The after pair from the last write is kept — it is the row's real
        // final state.
        existing.after = snap.after;
        return;
      }
      merged.set(key, { ...snap, firstAt: idx });
    });

    const ordered = [...merged.values()].sort((a, b) => a.firstAt - b.firstAt);

    for (const snapshot of ordered) {
      // NOTE: PhysicalInventoryLedger has no binLocationId column. The snapshot
      // still carries it so callers/tests can assert WHICH row was changed;
      // adding the column is a separate schema change.
      await tx.physicalInventoryLedger.create({
        data: {
          productId: snapshot.productId,
          variantId: snapshot.variantId ?? null,
          warehouseId: params.warehouseId,
          quantity: snapshot.moved,
          direction: params.direction,
          stockBefore: snapshot.before.quantity,
          stockAfter: snapshot.after?.quantity ?? 0,
          reservedBefore: snapshot.before.reservedQuantity,
          reservedAfter: snapshot.after?.reservedQuantity ?? 0,
          type: params.type,
          reason: params.reference,
          performedBy: params.performedBy,
          unitCost:
            params.unitCost != null
              ? new Prisma.Decimal(params.unitCost)
              : null,
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
      let currentStock = 0;
      let currentReserved = 0;
      if (t.variantId) {
        const v = await tx.productVariant.findUnique({
          where: { id: t.variantId },
          select: { managedStockQuantity: true, reservedStock: true },
        });
        currentStock = v?.managedStockQuantity ?? 0;
        currentReserved = v?.reservedStock ?? 0;
      } else {
        const p = await tx.product.findUnique({
          where: { id: t.productId },
          select: { managedStockQuantity: true, reservedStock: true },
        });
        currentStock = p?.managedStockQuantity ?? 0;
        currentReserved = p?.reservedStock ?? 0;
      }

      const stockAfter = currentStock;
      const stockBefore =
        direction === 'IN' ? currentStock - t.qty : currentStock + t.qty;

      // Capture reserved state transition. ORDER_DEDUCTION decremented reservedStock
      // (read after the decrement), so before = after + qty. All other types leave
      // reservedStock unchanged, so before == after == currentReserved.
      let reservedBefore: number | null;
      let reservedAfter: number | null;
      if (type === 'ORDER_DEDUCTION') {
        reservedAfter = currentReserved;
        reservedBefore = currentReserved + t.qty;
      } else {
        reservedBefore = currentReserved;
        reservedAfter = currentReserved;
      }

      await tx.managedStockLedger.create({
        data: {
          productId: t.productId,
          variantId: t.variantId,
          comboId: null,
          quantity: t.qty,
          direction,
          type,
          stockBefore,
          stockAfter,
          reservedBefore,
          reservedAfter,
          referenceType,
          referenceId,
          reason: note,
          performedById: performedBy,
        },
      });
    }
  }

  /**
   * Apply one +/- move to the PhysicalInventory rows the targets resolve to.
   *
   * Returns one PhysicalChangeSnapshot per row actually written — the ledger
   * records these instead of re-querying, so stockBefore/stockAfter can never
   * disagree with the row that changed.
   *
   * Decrements are guarded (see below) and run on the caller's transaction.
   */
  private async applyPhysicalChange(
    targets: PhysicalTarget[],
    op: 'increment' | 'decrement',
    field: 'quantity' | 'reservedQuantity',
    tx: Prisma.TransactionClient,
  ): Promise<PhysicalChangeSnapshot[]> {
    const snapshots: PhysicalChangeSnapshot[] = [];
    const deduped = new Map<string, PhysicalTarget>();
    for (const t of targets) {
      const key = `${t.productId}|${t.variantId || ''}|${t.warehouseId}|${t.binLocationId || ''}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.qty += t.qty;
      } else {
        deduped.set(key, { ...t });
      }
    }

    for (const t of deduped.values()) {
      let existing: any = null;
      if (op === 'decrement' && !t.binLocationId) {
        existing = await tx.physicalInventory.findFirst({
          where: {
            productId: t.productId,
            variantId: t.variantId || null,
            warehouseId: t.warehouseId,
            quantity: { gt: 0 },
          },
        });
        if (!existing) {
          existing = await tx.physicalInventory.findFirst({
            where: {
              productId: t.productId,
              variantId: t.variantId || null,
              warehouseId: t.warehouseId,
              binLocationId: null,
            },
          });
        }
      } else {
        const whereClause: any = {
          productId: t.productId,
          variantId: t.variantId || null,
          warehouseId: t.warehouseId,
        };
        if (t.binLocationId) {
          whereClause.binLocationId = t.binLocationId;
        } else {
          whereClause.binLocationId = null;
        }
        existing = await tx.physicalInventory.findFirst({ where: whereClause });
      }

      if (!existing && op === 'decrement') {
        throw new BadRequestException(
          `No physical inventory record for product ${t.productId}${t.variantId ? ` variant ${t.variantId}` : ''} in warehouse ${t.warehouseId}${t.binLocationId ? ` bin ${t.binLocationId}` : ''}`,
        );
      }

      if (existing) {
        const before = {
          quantity: Number(existing.quantity ?? 0),
          reservedQuantity: Number(existing.reservedQuantity ?? 0),
        };

        if (op === 'increment' && field === 'reservedQuantity') {
          // A non-allocated reservation may only hold stock that EXISTS and
          // is not already held: quantity − reservedQuantity >= qty. The old
          // path incremented reservedQuantity unconditionally, so a reserve
          // could push reserved past on-hand and every availability figure
          // downstream went negative. The write is a compare-and-swap on the
          // reservedQuantity just read — a concurrent hold or
          // reservation-consuming deduct that changed it fails the claim
          // instead of over-reserving.
          const available = before.quantity - before.reservedQuantity;
          if (available < t.qty) {
            throw new BadRequestException(
              `Insufficient available physical stock to reserve for product ${t.productId}${t.variantId ? ` variant ${t.variantId}` : ''} in warehouse ${t.warehouseId}${t.binLocationId ? ` bin ${t.binLocationId}` : ''}. ` +
                `Available: ${available}, needed: ${t.qty}.`,
            );
          }
          const claimed = await tx.physicalInventory.updateMany({
            where: { id: existing.id, reservedQuantity: before.reservedQuantity },
            data: { reservedQuantity: { increment: t.qty } },
          });
          if (claimed.count === 0) {
            throw new ConflictException(
              `Physical reservation for product ${t.productId}${t.variantId ? ` variant ${t.variantId}` : ''} in warehouse ${t.warehouseId} raced another stock movement — retry.`,
            );
          }
        } else if (op === 'decrement') {
          // Guarded decrement. A bare `update({ where: {id} })` re-reads the
          // row and decrements whatever it finds, so two concurrent movements
          // out of the same bin both succeed and the row ends up NEGATIVE —
          // unrecoverable, because every later movement treats the negative as
          // real available stock. The `quantity >= qty` predicate makes the
          // write atomic: the loser of the race updates 0 rows and is rejected.
          const claimed = await tx.physicalInventory.updateMany({
            where: {
              id: existing.id,
              [field]: { gte: t.qty },
            },
            data: { [field]: { decrement: t.qty } },
          });
          if (claimed.count === 0) {
            throw new ConflictException(
              `Insufficient physical stock for product ${t.productId}${t.variantId ? ` variant ${t.variantId}` : ''} in warehouse ${t.warehouseId}${t.binLocationId ? ` bin ${t.binLocationId}` : ''}. ` +
                `Tried to remove ${t.qty}, only ${before[field]} available. Another stock movement consumed it first — retry.`,
            );
          }
        } else {
          await tx.physicalInventory.update({
            where: { id: existing.id },
            data: { [field]: { increment: t.qty } },
          });
        }

        const after = {
          quantity:
            field === 'quantity' ? before.quantity + (op === 'decrement' ? -t.qty : t.qty) : before.quantity,
          reservedQuantity:
            field === 'reservedQuantity'
              ? before.reservedQuantity + (op === 'decrement' ? -t.qty : t.qty)
              : before.reservedQuantity,
        };
        snapshots.push({
          physicalInventoryId: existing.id,
          productId: t.productId,
          variantId: t.variantId || null,
          binLocationId: existing.binLocationId ?? t.binLocationId ?? null,
          before,
          after,
          moved: t.qty,
        });
      } else {
        if (field === 'reservedQuantity') {
          // Reserving against a row that does not exist would seed a row
          // with reservedQuantity > quantity — a phantom hold on stock that
          // was never there. Mirror the decrement-on-missing behaviour and
          // refuse; stock must be received (add) before it can be held.
          throw new BadRequestException(
            `No physical inventory record for product ${t.productId}${t.variantId ? ` variant ${t.variantId}` : ''} in warehouse ${t.warehouseId}${t.binLocationId ? ` bin ${t.binLocationId}` : ''}`,
          );
        }
        // Past the throw-guard above, field is provably 'quantity'
        // (a reservedQuantity create is refused), so the seed is explicit.
        const created = await tx.physicalInventory.create({
          data: {
            productId: t.productId,
            variantId: t.variantId || null,
            warehouseId: t.warehouseId,
            binLocationId: t.binLocationId || null,
            quantity: op === 'increment' ? t.qty : 0,
            reservedQuantity: 0,
          },
          select: { id: true, binLocationId: true },
        });
        const zero = { quantity: 0, reservedQuantity: 0 };
        const seeded = {
          quantity: t.qty,
          reservedQuantity: 0,
        };
        snapshots.push({
          physicalInventoryId: created.id,
          productId: t.productId,
          variantId: t.variantId || null,
          binLocationId: created.binLocationId ?? null,
          before: zero,
          after: seeded,
          moved: t.qty,
        });
      }
    }

    return snapshots;
  }

  async operatePhysical(
    operation: 'reserve' | 'release' | 'deduct' | 'add',
    params: StockOperationParams,
  ) {
    if (!params.warehouseId) {
      throw new BadRequestException(
        'warehouseId required for physical inventory operations',
      );
    }
    const exec = async (tx: Prisma.TransactionClient) => {
      let targets = await this.resolveTargets(params, tx);
      let effectiveOperation = operation;
      let isNegative = false;

      if (params.quantity < 0) {
        isNegative = true;
        targets = targets.map((t) => ({ ...t, qty: Math.abs(t.qty) }));
        if (operation === 'add') {
          effectiveOperation = 'deduct';
        }
      }

      for (const t of targets) {
        const product = await tx.product.findUnique({
          where: { id: t.productId },
          select: { availabilityMode: true },
        });
        if (product) {
          if (product.availabilityMode === 'ALWAYS_IN_STOCK') {
            throw new BadRequestException(
              `Product is always in stock — no physical adjustments allowed`,
            );
          }
          if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
            throw new BadRequestException(
              `Product is always out of stock — no physical adjustments allowed`,
            );
          }
        }
      }

      const physicalTargets = targets.map((t) => ({
        productId: t.productId,
        variantId: t.variantId,
        warehouseId: params.warehouseId!,
        qty: t.qty,
        binLocationId: params.binLocationId,
      }));

      if (effectiveOperation === 'reserve') {
        const snaps = await this.applyPhysicalChange(
          physicalTargets,
          'increment',
          'reservedQuantity',
          tx,
        );
        await this.logPhysicalInventoryLedger({
          snapshots: snaps,
          warehouseId: params.warehouseId!,
          direction: 'OUT',
          type: params.ledgerType || 'RESERVE',
          reference: params.reference,
          performedBy: params.performedBy,
          unitCost: params.unitCost,
          tx,
        });
      } else if (effectiveOperation === 'release') {
        const snaps = await this.applyPhysicalChange(
          physicalTargets,
          'decrement',
          'reservedQuantity',
          tx,
        );
        await this.logPhysicalInventoryLedger({
          snapshots: snaps,
          warehouseId: params.warehouseId!,
          direction: 'IN',
          type: params.ledgerType || 'RELEASE',
          reference: params.reference,
          performedBy: params.performedBy,
          unitCost: params.unitCost,
          tx,
        });
      } else if (effectiveOperation === 'deduct') {
        // A deduction normally CONSUMES a reservation (a dispatched order), so
        // the hold is released alongside the stock. A caller that never
        // reserved anything — a warehouse TRANSFER moving already-available
        // stock, or a manual negative adjustment — must not decrement
        // reservedQuantity: there is no hold to release, and the decrement
        // would drive the column negative and inflate the available quantity
        // the stock router reads (quantity - reservedQuantity).
        const consumesReservation =
          params.consumesReservation ?? (!isNegative && operation === 'deduct');

        const qtySnaps = await this.applyPhysicalChange(
          physicalTargets,
          'decrement',
          'quantity',
          tx,
        );
        const snapshots = [...qtySnaps];
        if (consumesReservation) {
          snapshots.push(
            ...(await this.applyPhysicalChange(
              physicalTargets,
              'decrement',
              'reservedQuantity',
              tx,
            )),
          );
        }
        await this.logPhysicalInventoryLedger({
          snapshots,
          warehouseId: params.warehouseId!,
          direction: 'OUT',
          type:
            params.ledgerType ||
            (isNegative ? 'PHYSICAL_ADJUSTMENT' : 'DEDUCTION'),
          reference: params.reference,
          performedBy: params.performedBy,
          unitCost: params.unitCost,
          tx,
        });
      } else if (effectiveOperation === 'add') {
        const snaps = await this.applyPhysicalChange(
          physicalTargets,
          'increment',
          'quantity',
          tx,
        );
        await this.logPhysicalInventoryLedger({
          snapshots: snaps,
          warehouseId: params.warehouseId!,
          direction: 'IN',
          type: params.ledgerType || 'ADD',
          reference: params.reference,
          performedBy: params.performedBy,
          unitCost: params.unitCost,
          tx,
        });
        // Update bin location on variant if provided
        if (params.binLocationId) {
          for (const t of targets) {
            if (t.variantId) {
              await tx.productVariant.update({
                where: { id: t.variantId },
                data: { binLocationId: params.binLocationId },
              });
            }
          }
        }
      }
      return targets;
    };

    if (params.tx) {
      const res = await exec(params.tx);
      await this.cache.invalidateByPrefix('product:');
      return res;
    }
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.prisma.$transaction(exec, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        await this.cache.invalidateByPrefix('product:');
        return res;
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

  async operate(
    operation: 'reserve' | 'release' | 'deduct' | 'add' | 'scrap',
    params: StockOperationParams,
  ) {
    const exec = async (tx: Prisma.TransactionClient) => {
      let targets = await this.resolveTargets(params, tx);
      let effectiveOperation = operation;

      // Mirror operatePhysical's negative-quantity contract: a negative
      // quantity is a magnitude plus a direction flip for 'add' (a negative
      // add is a removal). Without this, a negative reserve/deduct fed the
      // raw negative into the counters and inverted the movement.
      if (params.quantity < 0) {
        targets = targets.map((t) => ({ ...t, qty: Math.abs(t.qty) }));
        if (operation === 'add') {
          effectiveOperation = 'deduct';
        }
      }

      // Aggregate duplicate targets (same product + variant) BEFORE any
      // availability check, like the physical path: a combo listing the
      // same component twice (or a repeated line) must be guarded on the
      // SUM, not pass twice on partial quantities.
      const aggregated = new Map<string, StockTarget>();
      for (const t of targets) {
        const key = `${t.productId}|${t.variantId ?? ''}`;
        const existing = aggregated.get(key);
        if (existing) {
          existing.qty += t.qty;
        } else {
          aggregated.set(key, { ...t });
        }
      }
      targets = [...aggregated.values()];

      await this.lockRows(targets, tx);

      const targetKey = (t: StockTarget) => `${t.productId}|${t.variantId ?? ''}`;
      const movedOnly = (moved: Set<string>) =>
        targets.filter((t) => moved.has(targetKey(t)));

      if (effectiveOperation === 'reserve') {
        const moved = await this.applyStockChange(targets, 'reservedStock', 'increment', tx);
        const movedTargets = movedOnly(moved);
        await this.logInventory(
          movedTargets,
          'reserve',
          `Reserved for ${params.reference}`,
          params.performedBy,
          tx,
        );
        for (const t of movedTargets) {
          const p = await tx.product.findUnique({
            where: { id: t.productId },
            select: { availabilityMode: true, managedStockQuantity: true, reservedStock: true },
          });
          if (p) {
            let currentStock = 0;
            let currentReserved = 0;
            if (t.variantId) {
              const v = await tx.productVariant.findUnique({
                where: { id: t.variantId },
                select: { managedStockQuantity: true, reservedStock: true },
              });
              currentStock = v?.managedStockQuantity ?? 0;
              currentReserved = v?.reservedStock ?? 0;
            } else {
              currentStock = p.managedStockQuantity ?? 0;
              currentReserved = p.reservedStock ?? 0;
            }
            let orderId: string | null = null;
            const displayIdMatch = params.reference.match(/ORD-\d{6}-\d{4}/);
            if (displayIdMatch) {
              const order = await tx.order.findFirst({
                where: { displayId: displayIdMatch[0] },
                select: { id: true },
              });
              orderId = order?.id || null;
            }
            await tx.managedStockLedger.create({
              data: {
                productId: t.productId,
                variantId: t.variantId,
                comboId: params.comboId ?? null,
                quantity: t.qty,
                direction: 'OUT',
                type: (params.ledgerType as any) || 'RESERVE',
                stockBefore: currentStock,
                stockAfter: currentStock,
                reservedBefore: currentReserved - t.qty,
                reservedAfter: currentReserved,
                referenceType: 'ORDER',
                referenceId: orderId,
                performedById: params.performedBy || 'system',
                note: `Reserved for ${params.reference}`,
              },
            });
          }
        }
      } else if (effectiveOperation === 'release') {
        const moved = await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
        const movedTargets = movedOnly(moved);
        await this.logInventory(
          movedTargets,
          'release',
          `Released for ${params.reference}`,
          params.performedBy,
          tx,
        );
        for (const t of movedTargets) {
          const p = await tx.product.findUnique({
            where: { id: t.productId },
            select: { availabilityMode: true, managedStockQuantity: true, reservedStock: true },
          });
          if (p) {
            let currentStock = 0;
            let currentReserved = 0;
            if (t.variantId) {
              const v = await tx.productVariant.findUnique({
                where: { id: t.variantId },
                select: { managedStockQuantity: true, reservedStock: true },
              });
              currentStock = v?.managedStockQuantity ?? 0;
              currentReserved = v?.reservedStock ?? 0;
            } else {
              currentStock = p.managedStockQuantity ?? 0;
              currentReserved = p.reservedStock ?? 0;
            }
            let orderId: string | null = null;
            const displayIdMatch = params.reference.match(/ORD-\d{6}-\d{4}/);
            if (displayIdMatch) {
              const order = await tx.order.findFirst({
                where: { displayId: displayIdMatch[0] },
                select: { id: true },
              });
              orderId = order?.id || null;
            }
            await tx.managedStockLedger.create({
              data: {
                productId: t.productId,
                variantId: t.variantId,
                comboId: params.comboId ?? null,
                quantity: t.qty,
                direction: 'IN',
                type: (params.ledgerType as any) || 'RELEASE',
                stockBefore: currentStock,
                stockAfter: currentStock,
                reservedBefore: currentReserved + t.qty,
                reservedAfter: currentReserved,
                referenceType: 'ORDER',
                referenceId: orderId,
                performedById: params.performedBy || 'system',
                note: `Released for ${params.reference}`,
              },
            });
          }
        }
      } else if (effectiveOperation === 'deduct') {
        const qtyMoved = await this.applyStockChange(
          targets,
          'managedStockQuantity',
          'decrement',
          tx,
        );
        const reservedMoved = await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
        // Ledger + costing cover the legs that actually moved (on-hand
        // and/or the released hold). A target skipped by both — a product
        // the managed engine does not govern — gets no fabricated rows.
        const movedTargets = movedOnly(
          new Set([...qtyMoved, ...reservedMoved]),
        );
        if (!params.skipCostingLotDeduct) {
          await this.deductCostingLots(movedTargets, params, tx);
        }
        await this.logInventory(
          movedTargets,
          'order_fulfilled',
          `Deducted for ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          movedTargets,
          'OUT',
          'ORDER_DEDUCTION',
          'ORDER',
          params.reference,
          params.performedBy,
          `Deducted for ${params.reference}`,
          tx,
        );
      } else if (effectiveOperation === 'add') {
        const moved = await this.applyStockChange(
          targets,
          'managedStockQuantity',
          'increment',
          tx,
        );
        const movedTargets = movedOnly(moved);
        await this.logInventory(
          movedTargets,
          params.reference.startsWith('GRN-') ||
            params.reference.startsWith('PO-')
            ? 'purchase_receive'
            : 'manual_adjustment',
          `Added via ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          movedTargets,
          'IN',
          (params.ledgerType as Prisma.$ManagedStockLedgerPayload['scalars']['type']) || 'MANUAL_ADD',
          (params.referenceType as Prisma.$ManagedStockLedgerPayload['scalars']['referenceType']) || 'MANUAL',
          params.referenceId ?? params.reference,
          params.performedBy,
          `Added via ${params.reference}`,
          tx,
        );
      } else if (effectiveOperation === 'scrap') {
        // Scrap may only consume UNRESERVED on-hand (guardAgainstReserved):
        // reserved units belong to open orders.
        const moved = await this.applyStockChange(
          targets,
          'managedStockQuantity',
          'decrement',
          tx,
          { guardAgainstReserved: true },
        );
        const movedTargets = movedOnly(moved);
        await this.logInventory(
          movedTargets,
          'scrap',
          `Scrapped: ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          movedTargets,
          'OUT',
          (params.ledgerType as Prisma.$ManagedStockLedgerPayload['scalars']['type']) || 'MANUAL_REMOVE',
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
      const res = await exec(params.tx);
      await this.cache.invalidateByPrefix('product:');
      return res;
    }
    const res = await this.prisma.$transaction(exec);
    await this.cache.invalidateByPrefix('product:');
    return res;
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

  async checkPhysicalAvailability(productId: string, warehouseId: string, variantId?: string) {
    const where: any = { productId, warehouseId };
    if (variantId) {
      where.variantId = variantId;
    }
    const records = await this.prisma.physicalInventory.findMany({
      where,
      select: { quantity: true, reservedQuantity: true },
    });
    if (records.length === 0) {
      return {
        available: false,
        currentStock: 0,
        reserved: 0,
        availableStock: 0,
      };
    }
    const totalQty = records.reduce((sum, r) => sum + r.quantity, 0);
    const totalReserved = records.reduce((sum, r) => sum + r.reservedQuantity, 0);
    const availableStock = totalQty - totalReserved;
    return {
      // Available means something can actually be taken: stock that is
      // fully reserved (availableStock 0) is NOT available, even though
      // on-hand is positive.
      available: availableStock > 0,
      currentStock: totalQty,
      reserved: totalReserved,
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

  /**
   * Claim + allocate physical reservation for an order item or combo component.
   * Strategy: parent upsert (atomic) + Serializable transaction with check-before-create.
   * No P2002 possible: parent uses upsert, allocations check existing before create.
   * Retry on serialization conflict.
   */
  async reservePhysicalAllocated(params: {
    orderId: string;
    cycleId: string;
    orderItemId?: string;
    comboComponentId?: string;
    productId: string;
    variantId?: string;
    warehouseId: string;
    quantity: number;
    tx?: Prisma.TransactionClient;
  }) {
    const exec = async (tx: Prisma.TransactionClient) => {
      let parent: any;
      if (params.comboComponentId) {
        parent = await tx.comboComponentPhysicalReservation.upsert({
          where: {
            componentId_cycleId: {
              componentId: params.comboComponentId,
              cycleId: params.cycleId,
            },
          },
          create: {
            orderId: params.orderId,
            componentId: params.comboComponentId,
            cycleId: params.cycleId,
            productId: params.productId,
            variantId: params.variantId || null,
            warehouseId: params.warehouseId,
            quantity: params.quantity,
            status: 'ACTIVE',
          },
          update: {},
        });
      } else if (params.orderItemId) {
        parent = await tx.physicalReservation.upsert({
          where: {
            orderItemId_cycleId: {
              orderItemId: params.orderItemId,
              cycleId: params.cycleId,
            },
          },
          create: {
            orderId: params.orderId,
            orderItemId: params.orderItemId,
            cycleId: params.cycleId,
            productId: params.productId,
            variantId: params.variantId || null,
            warehouseId: params.warehouseId,
            quantity: params.quantity,
            status: 'ACTIVE',
          },
          update: {},
        });
      } else {
        throw new BadRequestException('orderItemId or comboComponentId required');
      }

      const existingAllocations = params.comboComponentId
        ? await tx.comboComponentPhysicalReservationAllocation.findMany({
            where: { reservationId: parent.id },
          })
        : await tx.physicalReservationAllocation.findMany({
            where: { reservationId: parent.id },
          });

      if (existingAllocations.length > 0) {
        return existingAllocations;
      }

      const whereClause: any = {
        productId: params.productId,
        warehouseId: params.warehouseId,
        variantId: params.variantId || null,
      };

      const eligible = await tx.physicalInventory.findMany({
        where: whereClause,
        orderBy: { updatedAt: 'asc' },
      });

      let remaining = params.quantity;
      const newAllocations: any[] = [];

      for (const pi of eligible) {
        if (remaining <= 0) break;
        const available = pi.quantity - pi.reservedQuantity;
        if (available <= 0) continue;

        const allocQty = Math.min(remaining, available);

        if (params.comboComponentId) {
          const allocation = await tx.comboComponentPhysicalReservationAllocation.create({
            data: {
              reservationId: parent.id,
              physicalInventoryId: pi.id,
              binLocationId: pi.binLocationId,
              quantity: allocQty,
            },
          });
          newAllocations.push(allocation);
        } else {
          const allocation = await tx.physicalReservationAllocation.create({
            data: {
              reservationId: parent.id,
              physicalInventoryId: pi.id,
              binLocationId: pi.binLocationId,
              quantity: allocQty,
            },
          });
          newAllocations.push(allocation);
        }

        await tx.physicalInventory.update({
          where: { id: pi.id },
          data: { reservedQuantity: { increment: allocQty } },
        });

        remaining -= allocQty;
      }

      if (remaining > 0) {
        throw new BadRequestException(
          `Insufficient physical stock for product ${params.productId}. Requested: ${params.quantity}, allocated: ${params.quantity - remaining}`,
        );
      }

      return newAllocations;
    };

    if (params.tx) {
      return exec(params.tx);
    }

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(exec, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
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

  /**
   * Release physical reservations for an order item. Idempotent.
   */
  async releasePhysicalAllocated(params: {
    orderId: string;
    cycleId: string;
    orderItemId?: string;
    comboComponentId?: string;
    tx?: Prisma.TransactionClient;
  }) {
    const client = params.tx || this.prisma;

    let parent: any;
    if (params.comboComponentId) {
      parent = await client.comboComponentPhysicalReservation.findUnique({
        where: {
          componentId_cycleId: {
            componentId: params.comboComponentId,
            cycleId: params.cycleId,
          },
        },
        include: { allocations: true },
      });
    } else if (params.orderItemId) {
      parent = await client.physicalReservation.findUnique({
        where: {
          orderItemId_cycleId: {
            orderItemId: params.orderItemId,
            cycleId: params.cycleId,
          },
        },
        include: { allocations: true },
      });
    }

    if (!parent || parent.status === 'RELEASED' || parent.status === 'CONSUMED') return;

    for (const alloc of parent.allocations) {
      await client.physicalInventory.update({
        where: { id: alloc.physicalInventoryId },
        data: { reservedQuantity: { decrement: alloc.quantity } },
      });
    }

    if (params.comboComponentId) {
      await client.comboComponentPhysicalReservation.update({
        where: { id: parent.id },
        data: { status: 'RELEASED' },
      });
    } else {
      await client.physicalReservation.update({
        where: { id: parent.id },
        data: { status: 'RELEASED' },
      });
    }
  }

  /**
   * Fulfill physical reservation at HANDED_OVER: deduct quantity, consume FIFO, mark CONSUMED.
   * Idempotent: CONSUMED parent is skipped.
   */
  async fulfillPhysicalReservation(params: {
    orderId: string;
    cycleId: string;
    orderItemId?: string;
    comboComponentId?: string;
    quantity: number;
    reference: string;
    performedBy?: string;
    tx?: Prisma.TransactionClient;
  }) {
    const client = params.tx || this.prisma;

    let parent: any;
    if (params.comboComponentId) {
      parent = await client.comboComponentPhysicalReservation.findUnique({
        where: {
          componentId_cycleId: {
            componentId: params.comboComponentId,
            cycleId: params.cycleId,
          },
        },
        include: { allocations: true },
      });
    } else if (params.orderItemId) {
      parent = await client.physicalReservation.findUnique({
        where: {
          orderItemId_cycleId: {
            orderItemId: params.orderItemId,
            cycleId: params.cycleId,
          },
        },
        include: { allocations: true },
      });
    }

    if (!parent || parent.status === 'CONSUMED') return;

    // Atomic claim: ACTIVE → CONSUMED
    let updateResult: any;
    if (params.comboComponentId) {
      updateResult = await client.comboComponentPhysicalReservation.updateMany({
        where: { id: parent.id, status: 'ACTIVE' },
        data: { status: 'CONSUMED' },
      });
    } else {
      updateResult = await client.physicalReservation.updateMany({
        where: { id: parent.id, status: 'ACTIVE' },
        data: { status: 'CONSUMED' },
      });
    }
    if (updateResult.count === 0) return; // Already consumed

    let remaining = params.quantity;

    for (const alloc of parent.allocations) {
      if (remaining <= 0) break;

      const deductQty = Math.min(remaining, alloc.quantity);

      // Decrement quantity on PI row
      await client.physicalInventory.update({
        where: { id: alloc.physicalInventoryId },
        data: {
          quantity: { decrement: deductQty },
          reservedQuantity: { decrement: deductQty },
        },
      });

      // Consume FIFO CostingLots via CostingLotService
      const referenceType = params.comboComponentId ? 'COMBO_COMPONENT' : 'ORDER_ITEM';
      const referenceId = params.comboComponentId || params.orderItemId!;

      await this.costingLotService.consumeFIFOAggregated({
        productId: parent.productId,
        variantId: parent.variantId,
        warehouseId: parent.warehouseId,
        quantity: deductQty,
        type: 'FULFILLMENT',
        referenceType,
        referenceId,
        tx: client,
      });

      // Associate cycleId with new CostingLotConsumption records
      await client.costingLotConsumption.updateMany({
        where: {
          referenceType,
          referenceId,
          type: 'FULFILLMENT',
          cycleId: null,
        },
        data: { cycleId: params.cycleId },
      });

      // Write ledger entry
      const pi = await client.physicalInventory.findUnique({
        where: { id: alloc.physicalInventoryId },
        select: { quantity: true, reservedQuantity: true },
      });
      const reservedQty = pi?.reservedQuantity ?? 0;
      await client.physicalInventoryLedger.create({
        data: {
          productId: parent.productId,
          variantId: parent.variantId ?? null,
          warehouseId: parent.warehouseId,
          quantity: deductQty,
          direction: 'OUT',
          stockBefore: (pi?.quantity ?? 0) + deductQty,
          stockAfter: pi?.quantity ?? 0,
          reservedBefore: reservedQty + deductQty,
          reservedAfter: reservedQty,
          type: 'DEDUCTION',
          reason: params.reference,
          performedBy: params.performedBy,
        },
      });

      remaining -= deductQty;
    }

    // Physical quantities were written directly (not via operatePhysical) —
    // the storefront product cache must be cleared so stock reflects the
    // consumed reservation immediately.
    await this.cache.invalidateByPrefix('product:');
  }

  async hasExistingPhysicalReservation(
    orderId: string,
    orderItemId?: string,
    comboComponentId?: string,
    cycleId?: string,
  ): Promise<boolean> {
    if (comboComponentId) {
      const where: any = { orderId, status: { in: ['ACTIVE', 'CONSUMED'] } };
      where.componentId = comboComponentId;
      if (cycleId) where.cycleId = cycleId;
      const existing = await this.prisma.comboComponentPhysicalReservation.findFirst({ where });
      return !!existing;
    } else {
      const where: any = { orderId, status: { in: ['ACTIVE', 'CONSUMED'] } };
      if (orderItemId) where.orderItemId = orderItemId;
      if (cycleId) where.cycleId = cycleId;
      const existing = await this.prisma.physicalReservation.findFirst({ where });
      return !!existing;
    }
  }

  async hasExistingPhysicalRelease(referenceId: string): Promise<boolean> {
    const existing = await this.prisma.physicalReservation.findFirst({
      where: {
        orderId: referenceId,
        status: { in: ['RELEASED', 'CONSUMED'] },
      },
    });
    return !!existing;
  }

  async createCostingLotForAdjustment(params: {
    productId: string;
    variantId?: string;
    warehouseId: string;
    quantity: number;
    unitCost: number;
    reference: string;
    /** Caller's transaction — costing writes must join it (see below). */
    tx?: Prisma.TransactionClient;
  }) {
    const lotNumber = `ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await (params.tx ?? this.prisma).costingLot.create({
      data: {
        productId: params.productId,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        lotNumber,
        unitCost: new Prisma.Decimal(params.unitCost),
        totalCost: new Prisma.Decimal(params.unitCost * params.quantity),
        quantity: params.quantity,
        remainingQty: params.quantity,
        receivedAt: new Date(),
      },
    });
  }

  async deductCostingLotsForAdjustment(params: {
    productId: string;
    variantId?: string;
    warehouseId: string;
    quantity: number;
    /** Caller's transaction — costing writes must join it (see below). */
    tx?: Prisma.TransactionClient;
  }) {
    await this.costingLotService.consumeFIFO({
      productId: params.productId,
      variantId: params.variantId ?? null,
      warehouseId: params.warehouseId,
      // ConsumeFIFO decrements lots; callers pass a signed adjustment quantity
      // (negative = removal), so the magnitude is what must be consumed.
      quantity: Math.abs(params.quantity),
      type: 'ADJUSTMENT',
      referenceType: 'ADJUSTMENT',
      referenceId: `ADJ-${Date.now()}`,
      tx: params.tx,
      // A manual adjustment corrects physical stock, which may legitimately be
      // ahead of the received/received-costed quantity. Failing the adjustment
      // would leave stock that is demonstrably there un-recorded; the cost gap
      // is logged at ERROR and stays visible to reconciliation.
      allowShortfall: true,
    });
  }

  async bulkAdjustPhysical(params: {
    warehouseId: string;
    reason: string;
    items: {
      productId: string;
      variantId?: string;
      quantity: number;
      binLocationId?: string;
      unitCost?: number;
    }[];
  }) {
    const exec = async (tx: Prisma.TransactionClient) => {
      for (const item of params.items) {
        const targets = await this.resolveTargets(
          {
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            reference: params.reason,
          },
          tx,
        );

        let finalTargets = targets;
        let finalOp: 'add' | 'deduct' = item.quantity < 0 ? 'deduct' : 'add';

        if (item.quantity < 0) {
          finalTargets = targets.map((t) => ({ ...t, qty: Math.abs(t.qty) }));
        }

        for (const t of finalTargets) {
          const product = await tx.product.findUnique({
            where: { id: t.productId },
            select: { availabilityMode: true },
          });
          if (product) {
            if (product.availabilityMode === 'ALWAYS_IN_STOCK') {
              throw new BadRequestException(
                `Product is always in stock — no physical adjustments allowed`,
              );
            }
            if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
              throw new BadRequestException(
                `Product is always out of stock — no physical adjustments allowed`,
              );
            }
          }
        }

        const physicalTargets = finalTargets.map((t) => ({
          productId: t.productId,
          variantId: t.variantId,
          warehouseId: params.warehouseId,
          qty: t.qty,
          binLocationId: item.binLocationId,
        }));

        if (finalOp === 'deduct') {
          const snaps = await this.applyPhysicalChange(
            physicalTargets,
            'decrement',
            'quantity',
            tx,
          );
          await this.logPhysicalInventoryLedger({
            snapshots: snaps,
            warehouseId: params.warehouseId,
            direction: 'OUT',
            type: 'PHYSICAL_ADJUSTMENT',
            reference: params.reason,
            performedBy: undefined,
            unitCost: item.unitCost,
            tx,
          });
          // Costing joins THIS transaction: previously the helper wrote
          // through the root client, so a rolled-back adjustment still
          // consumed/created lots (and a committed one could lose them).
          await this.deductCostingLotsForAdjustment({
            productId: item.productId,
            variantId: item.variantId,
            warehouseId: params.warehouseId,
            quantity: Math.abs(item.quantity),
            tx,
          });
        } else if (finalOp === 'add') {
          const snaps = await this.applyPhysicalChange(
            physicalTargets,
            'increment',
            'quantity',
            tx,
          );
          await this.logPhysicalInventoryLedger({
            snapshots: snaps,
            warehouseId: params.warehouseId,
            direction: 'IN',
            type: 'PHYSICAL_ADJUSTMENT',
            reference: params.reason,
            performedBy: undefined,
            unitCost: item.unitCost,
            tx,
          });
          if (item.unitCost) {
            await this.createCostingLotForAdjustment({
              productId: item.productId,
              variantId: item.variantId,
              warehouseId: params.warehouseId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              reference: params.reason,
              tx,
            });
          }
          if (item.binLocationId) {
            for (const t of finalTargets) {
              if (t.variantId) {
                await tx.productVariant.update({
                  where: { id: t.variantId },
                  data: { binLocationId: item.binLocationId },
                });
              }
            }
          }
        }
      }
    };

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.prisma.$transaction(exec, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        await this.cache.invalidateByPrefix('product:');
        return res;
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

  async listPhysical(productId?: string, warehouseId?: string, binLocationId?: string) {
    const where: any = {};
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (binLocationId) {
      where.binLocationId = binLocationId;
    } else if (binLocationId === '') {
      where.binLocationId = null;
    }
    return this.prisma.physicalInventory.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, images: true, lowStockQty: true } },
        variant: {
          include: {
            attributeValues: {
              include: {
                attributeValue: {
                  select: { id: true, value: true, attribute: { select: { name: true } } },
                },
              },
            },
          },
        },
        warehouse: true,
        binLocation: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listReservations(warehouseId?: string, productId?: string) {
    const showPhysical = !warehouseId || warehouseId !== 'managed';
    const showManaged = !warehouseId || warehouseId === 'managed';

    const results: any[] = [];

    if (showPhysical) {
      const where: any = { reservedQuantity: { gt: 0 } };
      if (warehouseId && warehouseId !== 'all') where.warehouseId = warehouseId;
      if (productId) where.productId = productId;
      const phys = await this.prisma.physicalInventory.findMany({
        where,
        include: { product: { select: { id: true, name: true, sku: true, images: true } }, warehouse: true },
        orderBy: { updatedAt: 'desc' },
      });

      // Attach the order reference + "reserved since" date from the
      // reservation RECORDS. A PhysicalInventory row is an aggregate — it
      // has no order of its own — so resolve the ACTIVE PhysicalReservation
      // / ComboComponentPhysicalReservation rows for the same
      // product+variant+warehouse and surface the earliest one's createdAt
      // (stock has been held since then) plus every linked order.
      const reservationWhere: any = { status: 'ACTIVE' };
      if (warehouseId && warehouseId !== 'all') reservationWhere.warehouseId = warehouseId;
      if (productId) reservationWhere.productId = productId;
      const [itemReservations, comboReservations] = await Promise.all([
        this.prisma.physicalReservation.findMany({
          where: reservationWhere,
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.comboComponentPhysicalReservation.findMany({
          where: reservationWhere,
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      const allReservations = [...itemReservations, ...comboReservations];
      const reservationOrderIds = [...new Set(allReservations.map((r) => r.orderId))];
      const reservationOrders = reservationOrderIds.length
        ? await this.prisma.order.findMany({
            where: { id: { in: reservationOrderIds } },
            select: { id: true, displayId: true },
          })
        : [];
      const displayIdByOrderId = new Map(
        reservationOrders.map((o) => [o.id, o.displayId]),
      );
      const reservationsByStockKey = new Map<string, any[]>();
      for (const r of allReservations) {
        const key = `${r.productId}|${r.variantId ?? ''}|${r.warehouseId}`;
        const entry = {
          id: r.id,
          orderId: r.orderId,
          orderDisplayId: displayIdByOrderId.get(r.orderId) ?? null,
          quantity: r.quantity,
          createdAt: r.createdAt,
        };
        const list = reservationsByStockKey.get(key);
        if (list) list.push(entry);
        else reservationsByStockKey.set(key, [entry]);
      }

      for (const row of phys) {
        const linked =
          reservationsByStockKey.get(
            `${row.productId}|${row.variantId ?? ''}|${row.warehouseId}`,
          ) ?? [];
        const earliest = linked[0] ?? null;
        // "Reserved since" is the reservation record's createdAt — never
        // the PI row's updatedAt (any stock movement bumps that). Rows with
        // no reservation record (legacy non-allocated holds) fall back to
        // the PI row's own createdAt.
        const reservedSince = earliest?.createdAt ?? row.createdAt;
        const distinctOrderIds = [...new Set(linked.map((l) => l.orderId))];
        results.push({
          ...row,
          orderId: distinctOrderIds.length === 1 ? distinctOrderIds[0] : null,
          orderDisplayId:
            distinctOrderIds.length === 1
              ? (displayIdByOrderId.get(distinctOrderIds[0]) ?? null)
              : null,
          createdAt: reservedSince,
          reservedSince,
          updatedAt: reservedSince,
          reservations: linked,
        });
      }
    }

    if (showManaged) {
      const orderItemWhere: any = { managedStockReserved: true };
      if (productId) orderItemWhere.productId = productId;
      const managedItems = await this.prisma.orderItem.findMany({
        where: orderItemWhere,
        include: {
          product: { select: { id: true, name: true, sku: true, images: true } },
          variant: { select: { id: true, sku: true, managedStockQuantity: true, reservedStock: true } },
          order: { select: { id: true, displayId: true, updatedAt: true } },
        },
      });

      const comboCompWhere: any = { managedStockReserved: true };
      if (productId) comboCompWhere.productId = productId;
      const managedComboComps = await this.prisma.orderItemComboComponent.findMany({
        where: comboCompWhere,
        include: {
          orderItem: { include: { order: { select: { id: true, displayId: true, updatedAt: true } } } },
        },
      });

      // Load products for combo components manually
      const compProductIds = [...new Set(managedComboComps.map(c => c.productId))];
      const compProducts = compProductIds.length
        ? await this.prisma.product.findMany({
            where: { id: { in: compProductIds } },
            select: { id: true, name: true, sku: true, images: true, managedStockQuantity: true },
          })
        : [];
      const productMap = new Map(compProducts.map(p => [p.id, p]));

      // Load variants for combo components manually
      const compVariantIds = [...new Set(managedComboComps.map(c => c.variantId).filter(Boolean))] as string[];
      const compVariants = compVariantIds.length
        ? await this.prisma.productVariant.findMany({
            where: { id: { in: compVariantIds } },
            select: { id: true, sku: true, managedStockQuantity: true, reservedStock: true },
          })
        : [];
      const variantMap = new Map(compVariants.map(v => [v.id, v]));

      const formattedManaged = managedItems.map((item) => {
        const variantLabel = item.variant
          ? ` (${item.variant.sku})`
          : '';
        return {
          id: item.id,
          productId: item.productId,
          warehouseId: 'managed',
          quantity: item.variant ? item.variant.managedStockQuantity : ((item.product as any)?.managedStockQuantity ?? 0),
          reservedQuantity: item.quantity,
          // The orderItem IS the managed reservation record: link its order
          // and date the hold from the record's own createdAt. The order's
          // updatedAt (previously used here) moves on every order edit and
          // says nothing about when the stock was reserved.
          orderId: item.order.id,
          orderDisplayId: item.order.displayId,
          createdAt: item.createdAt,
          reservedSince: item.createdAt,
          updatedAt: item.createdAt,
          product: {
            id: item.product?.id,
            name: item.product?.name + variantLabel,
            sku: item.variant?.sku || item.product?.sku || '',
            images: item.product?.images || [],
          },
          warehouse: {
            id: 'managed',
            name: 'Managed Stock',
          },
          isManaged: true,
        };
      });

      const formattedComboComps = managedComboComps.map((comp) => {
        const prod = productMap.get(comp.productId);
        const variant = comp.variantId ? variantMap.get(comp.variantId) : null;
        const variantLabel = variant
          ? ` (${variant.sku})`
          : '';
        return {
          id: comp.id,
          productId: comp.productId,
          warehouseId: 'managed',
          quantity: variant ? variant.managedStockQuantity : (prod?.managedStockQuantity ?? 0),
          reservedQuantity: comp.totalQuantity,
          orderId: comp.orderItem.order.id,
          orderDisplayId: comp.orderItem.order.displayId,
          createdAt: comp.createdAt,
          reservedSince: comp.createdAt,
          updatedAt: comp.createdAt,
          product: {
            id: prod?.id,
            name: (prod?.name ?? 'Unknown Component') + variantLabel,
            sku: variant?.sku || prod?.sku || '',
            images: prod?.images || [],
          },
          warehouse: {
            id: 'managed',
            name: 'Managed Stock',
          },
          isManaged: true,
        };
      });

      results.push(...formattedManaged, ...formattedComboComps);
    }

    return results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getPhysicalRecord(id: string) {
    return this.prisma.physicalInventory.findUnique({
      where: { id },
      include: { product: { select: { id: true, name: true, sku: true, images: true } }, warehouse: true },
    });
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
