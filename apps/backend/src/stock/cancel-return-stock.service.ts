import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';
import { CostingLotService } from './costing-lot.service';
import { CacheService } from '../cache/cache.service';
import { Prisma } from '@prisma/client';

function stockKeyOf(productId: string, variantId?: string | null): string {
  return `${productId}::${variantId ?? ''}`;
}

/**
 * CancelReturnStockService
 *
 * Implements the exact inverse of the reserve→deduct forward flow.
 * Per-item, per-engine, cycle-safe restorations.
 *
 * Decision rules (exact inverse of plan v5):
 *
 * For each stock target (standalone OrderItem or combo OrderItemComboComponent):
 *   [Managed Engine]
 *     - if managedStockDeducted → stockService.operate('add')  → reset both flags
 *     - else if managedStockReserved → stockService.operate('release') → reset both flags
 *
 *   [Physical Engine]
 *     - if reservation.status === 'CONSUMED' → restore physical quantity → mark RESTORED
 *     - if reservation.status === 'ACTIVE'   → release reserved quantity → mark RELEASED
 *
 *   [Costing Lot Engine] (only when physical was CONSUMED)
 *     - restore CostingLotConsumptions scoped to cycleId + referenceId
 *
 * Cycle termination:
 *   - After processing all items: set OrderStockCycle.status = TERMINATED
 */
@Injectable()
export class CancelReturnStockService {
  private readonly logger = new Logger(CancelReturnStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly stockRouter: StockRouterService,
    private readonly costingLotService: CostingLotService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Main entry point — called on Cancel or Return.
   * Fully cycle-safe and idempotent (flag checks, status checks prevent double-apply).
   */
  /**
   * Business rule: 'Return Pending' must HOLD the reservation/deduction and
   * must NOT restore/release any stock.
   *
   * The forward flow consumes the reservation counter at deduction
   * (StockService.operate('deduct') folds `reservedStock`/`reservedQuantity`
   * into the ON-hand decrement). So the moment an order lands on
   * 'Return Pending', the reservation counter must be re-established — the
   * held quantity stays unavailable and untouched until manual 'Returned'.
   *
   * Idempotent: a single `RETURN_HOLD` ledger row per order gates re-runs
   * (webhook retries, dispatch sync + order-status path double-fire). Only
   * items that were actually deducted (managedStockDeducted === true, with a
   * held reservation flag) are re-held; early returns that were never deducted
   * are already reserved and pass through untouched.
   */
  async holdReservationForReturnPending(orderId: string): Promise<void> {
    const already = await this.prisma.managedStockLedger.findFirst({
      where: { referenceId: orderId, type: 'RETURN_HOLD' },
    });
    if (already) return;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                availabilityMode: true,
                manageStock: true,
                syncManagedStock: true,
                warehouseId: true,
              },
            },
            combo: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!order) return;

    const reference = `Return Hold: ${order.displayId || order.id}`;

    const cycle = await this.prisma.orderStockCycle.findFirst({
      where: { orderId, status: 'ACTIVE' },
    });
    const cycleId = cycle?.id ?? null;

    for (const item of order.items) {
      if (item.comboId) {
        const snapshots = await this.prisma.orderItemComboComponent.findMany({
          where: { orderItemId: item.id },
          include: { product: true },
        });
        for (const snap of snapshots) {
          if (!snap.managedStockDeducted || !snap.managedStockReserved)
            continue;
          await this.holdManaged(
            snap.productId,
            snap.variantId ?? undefined,
            snap.totalQuantity,
            reference,
            orderId,
          );
          await this.holdPhysical({
            product: snap.product,
            productId: snap.productId,
            variantId: snap.variantId ?? undefined,
            quantity: snap.totalQuantity,
            reference,
            orderId,
            cycleId,
            comboComponentId: snap.id,
          });
        }
        continue;
      }

      const product = item.product;
      if (!product) continue;
      if (!item.managedStockDeducted || !item.managedStockReserved) continue;

      await this.holdManaged(
        item.productId as string,
        item.variantId ?? undefined,
        item.quantity,
        reference,
        orderId,
      );
      await this.holdPhysical({
        itemId: item.id,
        product,
        productId: item.productId as string,
        variantId: item.variantId ?? undefined,
        quantity: item.quantity,
        reference,
        orderId,
        cycleId,
      });
    }
  }

  private async holdManaged(
    productId: string,
    variantId: string | undefined,
    quantity: number,
    reference: string,
    orderId: string,
  ) {
    try {
      await this.stockService.operate('reserve', {
        productId,
        variantId,
        quantity,
        reference,
        ledgerType: 'RETURN_HOLD',
        referenceType: 'ORDER',
        referenceId: orderId,
        performedBy: 'system',
      });
    } catch (e) {
      this.logger.error(
        `holdReservation: managed re-reserve failed for product ${productId}: ${(e as Error).message}`,
      );
    }
  }

  private async holdPhysical(params: {
    product: any;
    productId: string;
    variantId?: string;
    quantity: number;
    reference: string;
    orderId: string;
    cycleId: string | null;
    itemId?: string;
    comboComponentId?: string;
  }) {
    const {
      product,
      productId,
      variantId,
      quantity,
      reference,
      orderId,
      cycleId,
      itemId,
      comboComponentId,
    } = params;
    if (!product?.warehouseId) return;
    if (!cycleId) return;
    const mode = product.availabilityMode;
    if (mode !== 'PHYSICAL' && mode !== 'MANAGED_STOCK') return;

    // Only re-hold when the physical engine actually tracks this item: a
    // reservation exists for this order item / combo component.
    const reservationExists = comboComponentId
      ? Boolean(
          await this.prisma.comboComponentPhysicalReservation.findUnique({
            where: {
              componentId_cycleId: {
                componentId: comboComponentId,
                cycleId,
              },
            },
          }),
        )
      : Boolean(
          await this.prisma.physicalReservation.findUnique({
            where: {
              orderItemId_cycleId: { orderItemId: itemId!, cycleId },
            },
          }),
        );
    if (!reservationExists) return;

    try {
      await this.stockService.reservePhysical({
        productId,
        variantId,
        warehouseId: product.warehouseId,
        quantity,
        reference,
        ledgerType: 'RETURN_HOLD',
        referenceType: 'ORDER',
        referenceId: orderId,
        performedBy: 'system',
      });
    } catch (e) {
      this.logger.error(
        `holdPhysical: physical re-reserve failed for product ${productId}: ${(e as Error).message}`,
      );
    }
  }
  /**
   * THE shared order-cancel release routine.
   *
   * Every entry point that moves an order to 'Cancelled' must call this —
   * single cancel (`OrdersService.updateStatus`), bulk cancel, customer
   * self-cancel, import-driven cancel, refund-with-cancel
   * (`RefundsService.create`), and the dispatch/courier-driven cancel
   * (`DispatchService.syncOrderStatus`). `OrdersService.trash` also uses it
   * (release-on-trash). It releases BOTH layers: the managed hold/deduction
   * and the physical reservation.
   *
   * Idempotent by construction: item flags and reservation statuses are the
   * gate, so a retry / double-submit is a no-op.
   */
  async releaseForCancellation(params: {
    orderId: string;
    performedBy?: string;
    tx: Prisma.TransactionClient;
  }): Promise<void> {
    await this.restoreForOrder({
      ...params,
      referencePrefix: 'cancel',
    });
  }

  async restoreForOrder(params: {
    orderId: string;
    referencePrefix: 'cancel' | 'return';
    performedBy?: string;
    tx: Prisma.TransactionClient;
  }): Promise<void> {
    const { orderId, referencePrefix, performedBy, tx } = params;
    const reference = `${referencePrefix}-${orderId}`;

    // 1. Find ACTIVE cycle (if any)
    const cycle = await tx.orderStockCycle.findFirst({
      where: { orderId, status: 'ACTIVE' },
    });
    const cycleId = cycle?.id ?? null;

    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

    // 2. Load order items with product info
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                availabilityMode: true,
                manageStock: true,
                syncManagedStock: true,
                warehouseId: true,
                name: true,
              },
            },
          },
        },
      },
    });
    if (!order) return;

    // Cumulative settlement (audit item 4): units already settled by
    // item-level Returns (stockReconciled rows) must never restore twice.
    // Partial receives now leave flags/reservations ARMED until their line
    // is fully settled, so this blanket pass restores only each claim's
    // UNSETTLED remainder. Settled quantities are aggregated per key and
    // distributed FIFO across lines/snapshots (good first), mirroring the
    // item-level allocation.
    const settledByKey = new Map<string, { good: number; total: number }>();
    const priorReturns = await this.loadSettledReturns(tx, orderId);
    for (const prior of priorReturns) {
      const priorItems = Array.isArray((prior as any)?.items)
        ? ((prior as any).items as any[])
        : [];
      for (const pItem of priorItems) {
        const pQty = Math.floor(Number(pItem?.quantity ?? 0) || 0);
        if (!pItem?.productId || !(pQty > 0)) continue;
        const pDamaged = Math.min(
          pQty,
          Math.max(0, Math.floor(Number(pItem?.damagedQuantity ?? 0) || 0)),
        );
        const k = stockKeyOf(pItem.productId, pItem.variantId ?? undefined);
        const cur = settledByKey.get(k) ?? { good: 0, total: 0 };
        cur.good += pQty - pDamaged;
        cur.total += pQty;
        settledByKey.set(k, cur);
      }
    }
    const takeSettled = (
      productId: string,
      variantId: string | null | undefined,
      claimQty: number,
    ): { good: number; total: number } => {
      const cur = settledByKey.get(stockKeyOf(productId, variantId));
      if (!cur || claimQty <= 0) return { good: 0, total: 0 };
      const total = Math.min(claimQty, cur.total);
      const good = Math.min(total, cur.good);
      cur.total -= total;
      cur.good -= good;
      return { good, total };
    };

    for (const item of order.items) {
      if (!item.productId && !item.comboId) continue;

      // ── Combo Item ────────────────────────────────────────────────────────────
      if (item.comboId) {
        await this.restoreComboItem(
          tx,
          item,
          cycleId,
          imEnabled,
          reference,
          performedBy,
          takeSettled,
        );
        continue;
      }

      // ── Standalone Item ───────────────────────────────────────────────────────
      await this.restoreStandaloneItem(
        tx,
        item,
        cycleId,
        imEnabled,
        reference,
        performedBy,
        takeSettled(item.productId as string, item.variantId, item.quantity),
      );
    }

    // 3. Terminate cycle
    if (cycleId) {
      await tx.orderStockCycle.update({
        where: { id: cycleId },
        data: { status: 'TERMINATED' },
      });
      this.logger.log(`Cycle ${cycleId} TERMINATED for order ${orderId}`);
    }

    // Physical restores write physicalInventory directly inside the caller's
    // transaction (bypassing operatePhysical). Clear the product cache so the
    // restored stock is visible on the storefront immediately. Same pattern
    // as operatePhysical, which also invalidates when running inside a tx.
    await this.cache.invalidateByPrefix('product:');
  }

  /**
   * Task 6 (Fix 13): ITEM-LEVEL restore for unified Returns.
   *
   * restoreForOrder is blanket full-order — for a PARTIAL return it would
   * restock the kept/delivered part too. This restores ONLY the given item
   * quantities (Return.items: productId + variantId + qty), capped at each
   * order line's ordered quantity:
   * - matched products: exact-qty managed `add` + physical `add` (same
   *   authoritative operate paths the RTN flow uses — no flag/cycle reads
   *   required, so a second partial Return for the same order keeps working);
   * - unmatched products: NEVER touched (the kept part must NOT restock);
   * - matched claims are DISARMED (managed flags cleared, physical
   *   reservation marked handled) so a later blanket restoreForOrder (manual
   *   'Returned' confirmation) can never restore the same units twice. The
   *   steady state is then exact: returned units back on hand, kept units
   *   still deducted, future arrivals restore through this same path;
   * - the ACTIVE cycle terminates only on FULL coverage (every line fully
   *   restored) — a partial leaves it ACTIVE for what may still arrive.
   *
   * CUMULATIVE SETTLEMENT (inventory audit 2026-11-02, item 4): disarm is
   * CUMULATIVE, not per-receive. A claim is disarmed only when the total
   * settled quantity for its line (good restored + damaged, across ALL
   * settled returns for the order) reaches the line quantity. A partial
   * receive restores exactly its good units but leaves the managed flags
   * SET and the physical reservation in place, so a SECOND partial return
   * against the same line restores the remainder instead of no-oping
   * against already-cleared flags / an already-RESTORED reservation.
   * Settlement evidence comes from existing records only (no schema
   * change): prior stockReconciled Return rows are replayed FIFO across
   * the claims (the same distribution the original allocations used), and
   * this return's own already-applied ledger rows (managed RETURN adds /
   * physical RESTORATION rows under reference `return-<returnId>`) make a
   * retry after a partial shortfall resume instead of double-applying.
   *
   * Returns `unrestored`: good units that were received but could NOT be
   * put back into physical stock (reservation missing, or its allocations
   * cover fewer units than were deducted). Callers must not report those
   * units as restocked.
   */
  async restoreForReturnItems(params: {
    orderId: string;
    items: Array<{
      productId: string;
      variantId?: string | null;
      quantity: number;
      /** Units of `quantity` that arrived damaged — never restocked. */
      damagedQuantity?: number;
    }>;
    returnId: string;
    performedBy?: string;
    tx: Prisma.TransactionClient;
  }): Promise<{
    restored: Array<{ productId: string; variantId: string | null; quantity: number }>;
    unrestored: Array<{ productId: string; variantId: string | null; quantity: number }>;
  }> {
    const { orderId, items, returnId, performedBy, tx } = params;
    const reference = `return-${returnId}`;

    const cycle =
      (await tx.orderStockCycle.findFirst({ where: { orderId, status: 'ACTIVE' } })) ??
      (await tx.orderStockCycle.findFirst({ where: { orderId }, orderBy: { createdAt: 'asc' } }));
    const cycleId = cycle?.id ?? null;
    const activeCycleId =
      cycle && (cycle as any).status === 'ACTIVE' ? (cycle as any).id : null;

    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                availabilityMode: true,
                manageStock: true,
                syncManagedStock: true,
                warehouseId: true,
                name: true,
              },
            },
          },
        },
      },
    });
    if (!order) return { restored: [], unrestored: [] };

    // ---- Build matchable claims: standalone lines + combo snapshots --------
    type Claim = {
      kind: 'line' | 'snap';
      line: any;
      snap?: any;
      product: any;
      /** Full ordered quantity of the underlying line / snapshot. */
      totalQuantity: number;
      /** Units still unsettled (not restored, not damaged) after prior returns. */
      remaining: number;
      /** Good units already restored by EARLIER settled returns. */
      settledGood: number;
      /** Units (good + damaged) already settled by EARLIER settled returns. */
      settledTotal: number;
      /** Good units whose managed `add` already ran for THIS return (retry resume). */
      appliedManaged: number;
      /** Good units whose physical restore already ran for THIS return (retry resume). */
      appliedPhysical: number;
    };
    const claimsByKey = new Map<string, Claim[]>();
    const keyOf = (productId: string, variantId?: string | null) =>
      `${productId}::${variantId ?? ''}`;
    const allClaims: Claim[] = [];
    for (const line of (order as any).items ?? []) {
      if (!line.productId && !line.comboId) continue;
      if (line.comboId) {
        const snaps = await tx.orderItemComboComponent.findMany({
          where: { orderItemId: line.id },
          include: { product: true },
        });
        for (const snap of snaps as any[]) {
          const claim: Claim = {
            kind: 'snap',
            line,
            snap,
            product: snap.product,
            totalQuantity: snap.totalQuantity,
            remaining: snap.totalQuantity,
            settledGood: 0,
            settledTotal: 0,
            appliedManaged: 0,
            appliedPhysical: 0,
          };
          allClaims.push(claim);
          const k = keyOf(snap.productId, snap.variantId ?? undefined);
          if (!claimsByKey.has(k)) claimsByKey.set(k, []);
          claimsByKey.get(k)!.push(claim);
        }
        continue;
      }
      const claim: Claim = {
        kind: 'line',
        line,
        product: line.product,
        totalQuantity: line.quantity,
        remaining: line.quantity,
        settledGood: 0,
        settledTotal: 0,
        appliedManaged: 0,
        appliedPhysical: 0,
      };
      allClaims.push(claim);
      const k = keyOf(line.productId, line.variantId ?? undefined);
      if (!claimsByKey.has(k)) claimsByKey.set(k, []);
      claimsByKey.get(k)!.push(claim);
    }

    // ---- Cumulative settlement from EARLIER settled returns ----------------
    // Replay every stockReconciled Return for this order (excluding the one
    // being processed — the RTN dispatch flow pre-marks its damage row
    // reconciled before calling here) FIFO across the claims of each key,
    // good units first, exactly like the live allocation below. A claim
    // whose settledTotal reaches its line quantity is already disarmed;
    // the rest keep only their unsettled remainder claimable.
    const priorReturns = await this.loadSettledReturns(tx, orderId, returnId);
    for (const prior of priorReturns) {
      const priorItems = Array.isArray((prior as any)?.items)
        ? ((prior as any).items as any[])
        : [];
      for (const pItem of priorItems) {
        const pQty = Math.floor(Number(pItem?.quantity ?? 0) || 0);
        if (!pItem?.productId || !(pQty > 0)) continue;
        const pDamaged = Math.min(
          pQty,
          Math.max(0, Math.floor(Number(pItem?.damagedQuantity ?? 0) || 0)),
        );
        let pGoodLeft = pQty - pDamaged;
        let pWanted = pQty;
        const claims = claimsByKey.get(keyOf(pItem.productId, pItem.variantId ?? undefined)) ?? [];
        for (const claim of claims) {
          if (pWanted <= 0) break;
          const capacity = claim.totalQuantity - claim.settledTotal;
          if (capacity <= 0) continue;
          const take = Math.min(capacity, pWanted);
          const goodTake = Math.min(pGoodLeft, take);
          claim.settledGood += goodTake;
          claim.settledTotal += take;
          pGoodLeft -= goodTake;
          pWanted -= take;
        }
      }
    }
    for (const claim of allClaims) {
      claim.remaining = claim.totalQuantity - claim.settledTotal;
    }

    // ---- This return's own already-applied movements (retry resume) --------
    // When a previous attempt of THIS return applied part of the restore
    // but the return was left unreconciled (physical shortfall), its ledger
    // rows under `return-<returnId>` are the resume evidence: those units
    // must never be applied twice.
    const ownApplied = await this.loadOwnReturnApplied(tx, reference);
    for (const [k, sums] of ownApplied) {
      const claims = claimsByKey.get(k) ?? [];
      let managedLeft = sums.managed;
      let physicalLeft = sums.physical;
      for (const claim of claims) {
        if (managedLeft <= 0 && physicalLeft <= 0) break;
        const capacity = Math.max(0, claim.totalQuantity - claim.settledTotal);
        const m = Math.min(capacity, managedLeft);
        claim.appliedManaged += m;
        managedLeft -= m;
        const p = Math.min(capacity, physicalLeft);
        claim.appliedPhysical += p;
        physicalLeft -= p;
      }
    }

    // ---- Allocate Return quantities across matching claims (FIFO) ----------
    const restoredByKey = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
    const unrestoredByKey = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
    for (const item of items ?? []) {
      const qty = Math.floor(Number((item as any)?.quantity ?? 0));
      if (!item?.productId || !(qty > 0)) continue;
      const damaged = Math.min(
        qty,
        Math.max(0, Math.floor(Number((item as any)?.damagedQuantity ?? 0) || 0)),
      );
      let goodLeft = qty - damaged;
      const k = keyOf(item.productId, item.variantId ?? undefined);
      const claims = claimsByKey.get(k) ?? [];
      let wanted = qty;
      for (const claim of claims) {
        if (wanted <= 0) break;
        if (claim.remaining <= 0) continue;
        const take = Math.min(claim.remaining, wanted);
        claim.remaining -= take;
        wanted -= take;
        // Allocate the received split across claims; only good units move.
        const goodTake = Math.min(goodLeft, take);
        goodLeft -= goodTake;
        const damagedTake = take - goodTake;
        if (goodTake > 0) {
          const { physicalShortfall } = await this.restoreReturnClaim(
            tx, claim, goodTake, damagedTake, cycleId, imEnabled, reference, performedBy,
          );
          const reallyRestored = goodTake - physicalShortfall;
          if (reallyRestored > 0) {
            const agg = restoredByKey.get(k) ?? {
              productId: item.productId,
              variantId: (item.variantId ?? null) as string | null,
              quantity: 0,
            };
            agg.quantity += reallyRestored;
            restoredByKey.set(k, agg);
          }
          if (physicalShortfall > 0) {
            const agg = unrestoredByKey.get(k) ?? {
              productId: item.productId,
              variantId: (item.variantId ?? null) as string | null,
              quantity: 0,
            };
            agg.quantity += physicalShortfall;
            unrestoredByKey.set(k, agg);
          }
        } else {
          // Damaged-only allocation: settle ONLY the damaged share of the
          // claim (counters), never the whole line — the good remainder
          // stays armed for a later arrival (see disarmClaim).
          await this.disarmClaim(tx, claim, damagedTake, reference, performedBy);
        }
      }
      if (wanted > 0) {
        this.logger.warn(
          `Return ${returnId}: ${wanted} unit(s) of product ${item.productId} exceed the order quantity — skipped (never over-restore)`,
        );
      }
    }

    // ---- Terminate the ACTIVE cycle only on FULL coverage ------------------
    if (activeCycleId && allClaims.length > 0 && allClaims.every((c) => c.remaining <= 0)) {
      await tx.orderStockCycle.update({
        where: { id: activeCycleId },
        data: { status: 'TERMINATED' },
      });
      this.logger.log(`Cycle ${activeCycleId} TERMINATED for return ${returnId} (full coverage)`);
    }

    await this.cache.invalidateByPrefix('product:');
    return { restored: [...restoredByKey.values()], unrestored: [...unrestoredByKey.values()] };
  }

  /**
   * Earlier SETTLED returns for an order — the cumulative-settlement
   * evidence for the item-level restore path. A return counts as settled
   * only when its stockReconciled flag committed in the same transaction
   * as its stock movement (the guarded core's contract). Guarded for
   * transaction doubles that lack the delegate (older unit specs): no
   * delegate → no evidence → claims start unsettled, as before.
   */
  private async loadSettledReturns(
    tx: Prisma.TransactionClient,
    orderId: string,
    excludeReturnId?: string,
  ): Promise<any[]> {
    const delegate = (tx as any)?.return;
    if (!delegate || typeof delegate.findMany !== 'function') return [];
    const rows = await delegate.findMany({
      where: {
        orderId,
        stockReconciled: true,
        ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, items: true },
    });
    return (rows ?? []) as any[];
  }

  /**
   * Quantities THIS return already applied in an earlier (interrupted)
   * attempt, summed from the stock ledgers under its own reference
   * (`return-<returnId>`): managed `add` rows (type RETURN, referenceType
   * RETURN, referenceId = reference — StockService.operate stores the
   * reference string as referenceId when none is passed) and physical
   * RESTORATION rows (reason = reference). Keys → per-layer good units.
   */
  private async loadOwnReturnApplied(
    tx: Prisma.TransactionClient,
    reference: string,
  ): Promise<Map<string, { managed: number; physical: number }>> {
    const out = new Map<string, { managed: number; physical: number }>();
    const bump = (
      productId: string,
      variantId: string | null | undefined,
      layer: 'managed' | 'physical',
      qty: number,
    ) => {
      if (!(qty > 0)) return;
      const k = `${productId}::${variantId ?? ''}`;
      const cur = out.get(k) ?? { managed: 0, physical: 0 };
      cur[layer] += qty;
      out.set(k, cur);
    };
    const managedDelegate = (tx as any)?.managedStockLedger;
    if (managedDelegate && typeof managedDelegate.findMany === 'function') {
      const rows = (await managedDelegate.findMany({
        where: {
          referenceType: 'RETURN',
          referenceId: reference,
          type: 'RETURN',
          direction: 'IN',
        },
        select: { productId: true, variantId: true, quantity: true },
      })) as any[];
      for (const r of rows ?? []) {
        if (r?.productId) bump(r.productId, r.variantId, 'managed', Number(r.quantity) || 0);
      }
    }
    const physicalDelegate = (tx as any)?.physicalInventoryLedger;
    if (physicalDelegate && typeof physicalDelegate.findMany === 'function') {
      const rows = (await physicalDelegate.findMany({
        where: { reason: reference, type: 'RESTORATION' },
        select: { productId: true, variantId: true, quantity: true },
      })) as any[];
      for (const r of rows ?? []) {
        if (r?.productId) bump(r.productId, r.variantId, 'physical', Number(r.quantity) || 0);
      }
    }
    return out;
  }

  /**
   * Damaged-after-receive write-off. Decrements SELLABLE stock through the
   * authoritative engine for the product's availability mode — never a raw
   * quantity edit. Fails closed when available stock is insufficient.
   */
  async damageWriteOff(params: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    warehouseId?: string | null;
    reference: string;
    performedBy?: string;
    tx: Prisma.TransactionClient;
  }): Promise<{ managed: boolean; warehouseId: string | null }> {
    const { tx, productId, variantId, quantity, reference, performedBy } = params;
    if (!(quantity > 0)) {
      throw new BadRequestException('Damage quantity must be positive');
    }
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        availabilityMode: true,
        manageStock: true,
        warehouseId: true,
        managedStockQuantity: true,
        reservedStock: true,
      },
    });
    if (!product) throw new BadRequestException('Product not found');

    if ((product as any).availabilityMode === 'MANAGED_STOCK' && (product as any).manageStock) {
      const holder = variantId
        ? await tx.productVariant.findUnique({
            where: { id: variantId },
            select: { managedStockQuantity: true, reservedStock: true },
          })
        : product;
      const available =
        Number((holder as any)?.managedStockQuantity ?? 0) -
        Number((holder as any)?.reservedStock ?? 0);
      if (available < quantity) {
        throw new BadRequestException(
          `Only ${Math.max(0, available)} unit(s) available — cannot mark ${quantity} damaged.`,
        );
      }
      await this.stockService.operate('scrap', {
        productId,
        variantId: variantId ?? undefined,
        quantity,
        reference,
        performedBy: performedBy || 'system',
        tx,
        ledgerType: 'ADJUSTMENT',
        referenceType: 'ADJUSTMENT',
      });
      return { managed: true, warehouseId: null };
    }

    const warehouseId = params.warehouseId ?? (product as any).warehouseId ?? null;
    if (!warehouseId) {
      throw new BadRequestException(
        'No warehouse is set for this product — cannot write off damaged stock.',
      );
    }
    const rows = await tx.physicalInventory.findMany({
      where: { productId, variantId: variantId ?? null, warehouseId },
      select: { quantity: true, reservedQuantity: true },
    });
    const available = (rows as any[]).reduce(
      (s, r) => s + (Number(r.quantity) || 0) - (Number(r.reservedQuantity) || 0),
      0,
    );
    if (available < quantity) {
      throw new BadRequestException(
        `Only ${Math.max(0, available)} unit(s) available at this warehouse — cannot mark ${quantity} damaged.`,
      );
    }
    await this.stockService.operatePhysical('add', {
      productId,
      variantId: variantId ?? undefined,
      warehouseId,
      quantity: -quantity,
      reference,
      performedBy: performedBy || 'system',
      tx,
      ledgerType: 'ADJUSTMENT',
      referenceType: 'ADJUSTMENT',
    });
    return { managed: false, warehouseId };
  }

  /**
   * Damaged-only allocation: settle ONLY the damaged share of the claim.
   *
   * The damaged units are settled (nothing will ever restock for them) but
   * the rest of the line is NOT disarmed: the managed flags are cleared and
   * the physical reservation is marked handled ONLY when this take
   * completes the claim's cumulative settlement (claim.remaining reached
   * 0 — the caller decrements before calling). A damaged-only PARTIAL
   * therefore frees only the damaged units' hold counters and leaves the
   * good remainder fully armed for a later arrival — previously the whole
   * line was disarmed regardless of quantity, so the good remainder could
   * never restore (inventory audit 2026-11-02, item 4).
   */
  private async disarmClaim(
    tx: Prisma.TransactionClient,
    claim: {
      kind: 'line' | 'snap';
      line: any;
      snap?: any;
      product: any;
      remaining: number;
      settledGood: number;
      settledTotal: number;
    },
    damagedQty: number,
    reference: string,
    performedBy?: string,
  ): Promise<void> {
    if (damagedQty > 0) {
      await this.settleDamagedShareOfClaim(tx, claim, damagedQty, reference, performedBy);
    }
    if (claim.remaining > 0) return; // good remainder still armed — nothing else to do

    // The claim is now FULLY settled (this damaged take was the last share).
    await this.clearClaimManagedFlags(tx, claim);
    const cycle = await tx.orderStockCycle.findFirst({
      where: { orderId: claim.line.orderId, status: 'ACTIVE' },
    });
    if (!cycle) return;
    if (claim.kind === 'line') {
      const res = await tx.physicalReservation.findUnique({
        where: {
          orderItemId_cycleId: { orderItemId: claim.line.id, cycleId: cycle.id },
        },
      });
      if (res && ['ACTIVE', 'CONSUMED'].includes((res as any).status)) {
        await tx.physicalReservation.update({
          where: { id: (res as any).id },
          data: { status: 'RESTORED' },
        });
      }
    } else {
      const res = await tx.comboComponentPhysicalReservation.findUnique({
        where: {
          componentId_cycleId: { componentId: claim.snap.id, cycleId: cycle.id },
        },
      });
      if (res && ['ACTIVE', 'CONSUMED'].includes((res as any).status)) {
        await tx.comboComponentPhysicalReservation.update({
          where: { id: (res as any).id },
          data: { status: 'RESTORED' },
        });
      }
    }
  }

  /** Clear a claim's managed flags (line or combo snapshot). */
  private async clearClaimManagedFlags(
    tx: Prisma.TransactionClient,
    claim: { kind: 'line' | 'snap'; line: any; snap?: any },
  ): Promise<void> {
    if (claim.kind === 'line') {
      await tx.orderItem.update({
        where: { id: claim.line.id },
        data: { managedStockDeducted: false, managedStockReserved: false },
      });
    } else {
      await tx.orderItemComboComponent.update({
        where: { id: claim.snap.id },
        data: { managedStockDeducted: false, managedStockReserved: false },
      });
    }
  }

  /**
   * Settle the counters for a DAMAGED share of a claim: the units never
   * restock, so on-hand never moves — but the hold this share carries
   * (Return-Pending re-reserve / original reservation counter, managed and
   * physical) must be freed or it leaks availability forever. Flags and
   * reservation status are NOT touched here; the caller disarms those only
   * on full cumulative settlement.
   */
  private async settleDamagedShareOfClaim(
    tx: Prisma.TransactionClient,
    claim: {
      kind: 'line' | 'snap';
      line: any;
      snap?: any;
      product: any;
    },
    damagedQty: number,
    reference: string,
    performedBy?: string,
  ): Promise<void> {
    const product = claim.product;
    const holder = claim.kind === 'line' ? claim.line : claim.snap;
    if (!product || !holder) return;
    const productId = (claim.kind === 'line'
      ? claim.line.productId
      : claim.snap.productId) as string;
    const variantId = ((claim.kind === 'line'
      ? claim.line.variantId
      : claim.snap.variantId) ?? undefined) as string | undefined;

    // Managed counters for the damaged share.
    if (product.availabilityMode === 'MANAGED_STOCK' && product.manageStock) {
      if (holder.managedStockDeducted) {
        await this.releaseHeldReservation(
          tx, productId, variantId, damagedQty, reference, performedBy,
        );
      } else if (holder.managedStockReserved) {
        await this.stockService.operate('release', {
          productId,
          variantId,
          quantity: damagedQty,
          reference,
          performedBy: performedBy || 'system',
          tx,
          ledgerType: 'CANCEL_RELEASE',
        });
      }
    } else if (holder.managedStockDeducted || holder.managedStockReserved) {
      // Q6: product left MANAGED_STOCK — settle the managed claim's counters
      // for the damaged share only (no flags: the claim may still be open).
      await this.settleManagedClaimWithoutRestore(
        tx, claim.kind, holder, damagedQty, reference, performedBy, false,
      );
    }

    // Physical counters for the damaged share: free the held counter across
    // the reservation's allocations (guarded, budget-capped). On-hand never
    // moves — damaged units are never put back on the shelf.
    const cycle = await tx.orderStockCycle.findFirst({
      where: { orderId: claim.line.orderId, status: 'ACTIVE' },
    });
    if (!cycle) return;
    const reservation =
      claim.kind === 'line'
        ? await tx.physicalReservation.findUnique({
            where: {
              orderItemId_cycleId: { orderItemId: claim.line.id, cycleId: cycle.id },
            },
            include: { allocations: true },
          })
        : await tx.comboComponentPhysicalReservation.findUnique({
            where: {
              componentId_cycleId: { componentId: claim.snap.id, cycleId: cycle.id },
            },
            include: { allocations: true },
          });
    if (!reservation) return;
    if (!['ACTIVE', 'CONSUMED'].includes((reservation as any).status)) return;
    let budget = damagedQty;
    for (const alloc of (reservation as any).allocations ?? []) {
      if (budget <= 0) break;
      const take = Math.min((alloc as any).quantity, budget);
      if (take <= 0) continue;
      const res = await tx.physicalInventory.updateMany({
        where: {
          id: (alloc as any).physicalInventoryId,
          reservedQuantity: { gte: take },
        },
        data: { reservedQuantity: { decrement: take } },
      });
      if ((res as any)?.count > 0) budget -= take;
    }
  }

  /**
   * Owner decision 2026-10-23 (Q6): the restore layer follows the product's
   * availability mode AT RESTORE TIME. Managed (virtual) stock is restored
   * only while the product is in MANAGED_STOCK mode; a product that has
   * since moved to inventory-control restores to the PHYSICAL layer only —
   * the managed quantity is NEVER added back. The claim must still be
   * SETTLED, though: free the managed hold/reservation this order placed
   * and clear the flags. Otherwise the managed counter leaks a phantom hold
   * forever and a later flag-driven path could resurrect virtual stock.
   * Freeing a hold is not a restore: on-hand managed quantity never moves
   * here, only the reservation counter this order itself raised.
   */
  private async settleManagedClaimWithoutRestore(
    tx: Prisma.TransactionClient,
    kind: 'line' | 'snap',
    holder: any,
    qty: number,
    reference: string,
    performedBy?: string,
    disarm: boolean = true,
  ): Promise<void> {
    const productId = holder.productId as string;
    const variantId = (holder.variantId ?? undefined) as string | undefined;
    if (qty > 0) {
      if (holder.managedStockDeducted) {
        await this.releaseHeldReservation(tx, productId, variantId, qty, reference, performedBy);
      } else if (holder.managedStockReserved) {
        try {
          await this.stockService.operate('release', {
            productId,
            variantId,
            quantity: qty,
            reference,
            performedBy: performedBy || 'system',
            tx,
            ledgerType: 'CANCEL_RELEASE',
          });
        } catch (e) {
          // Counter may already be settled (retry after a partial attempt):
          // an already-free hold must not fail the restore.
          this.logger.warn(
            `settleManagedClaimWithoutRestore: release skipped (${productId}): ${(e as Error).message}`,
          );
        }
      }
    }
    if (!disarm) return;
    if (kind === 'line') {
      await tx.orderItem.update({
        where: { id: holder.id },
        data: { managedStockDeducted: false, managedStockReserved: false },
      });
    } else {
      await tx.orderItemComboComponent.update({
        where: { id: holder.id },
        data: { managedStockDeducted: false, managedStockReserved: false },
      });
    }
  }

  /**
   * Restore + (on FULL cumulative settlement) disarm ONE allocated claim
   * (see restoreForReturnItems). Managed: exact-qty `add` when deducted
   * (plus a capped release of the Return-Pending hold), capped `release`
   * when reserved-only. Physical: exact-qty on-hand restore for CONSUMED
   * reservations (capped `release` of the held counter for ACTIVE ones).
   *
   * The claim is disarmed (managed flags cleared, reservation marked
   * handled) ONLY when this take completes the claim's cumulative
   * settlement (claim.remaining reached 0 after the caller's decrement) —
   * a partial take restores its units and leaves the claim armed so the
   * next partial return against the same line restores the remainder.
   *
   * Returns the physical shortfall: good units of this take that the
   * physical layer could not put back (no reservation, or its allocations
   * cover fewer units). Managed-layer restores are exact by construction.
   */
  private async restoreReturnClaim(
    tx: Prisma.TransactionClient,
    claim: {
      kind: 'line' | 'snap';
      line: any;
      snap?: any;
      product: any;
      remaining: number;
      settledGood: number;
      settledTotal: number;
      appliedManaged: number;
      appliedPhysical: number;
    },
    qty: number,
    damagedTake: number,
    cycleId: string | null,
    imEnabled: boolean,
    reference: string,
    performedBy?: string,
  ): Promise<{ physicalShortfall: number }> {
    if (qty <= 0) return { physicalShortfall: 0 };
    const product = claim.product;
    const holder = claim.kind === 'line' ? claim.line : claim.snap;
    const productId = (claim.kind === 'line' ? claim.line.productId : claim.snap.productId) as string;
    const variantId = (claim.kind === 'line' ? claim.line.variantId : claim.snap.variantId) ?? undefined;
    if (!product) return { physicalShortfall: 0 };
    const finalSettle = claim.remaining <= 0;

    // The damaged share of THIS take settles its counters only (never
    // restocks, never disarms on its own).
    if (damagedTake > 0) {
      await this.settleDamagedShareOfClaim(tx, claim, damagedTake, reference, performedBy);
    }

    // A. Managed engine (exact-qty direct adds — RTN-path semantics).
    // On a retry of THIS return, units whose managed add already committed
    // in the interrupted attempt (claim.appliedManaged) are skipped.
    const managedQty = Math.max(0, qty - claim.appliedManaged);
    claim.appliedManaged = Math.max(0, claim.appliedManaged - qty);
    if (product.availabilityMode === 'MANAGED_STOCK' && product.manageStock) {
      if (holder.managedStockDeducted) {
        if (managedQty > 0) {
          await this.stockService.operate('add', {
            productId,
            variantId,
            quantity: managedQty,
            reference,
            performedBy: performedBy || 'system',
            tx,
            ledgerType: 'RETURN',
            referenceType: 'RETURN',
          });
          // Capped release of the Return-Pending hold (remainder stays held).
          await this.releaseHeldReservation(tx, productId, variantId, managedQty, reference, performedBy);
        }
      } else if (holder.managedStockReserved) {
        if (managedQty > 0) {
          await this.stockService.operate('release', {
            productId,
            variantId,
            quantity: managedQty,
            reference,
            performedBy: performedBy || 'system',
            tx,
            ledgerType: 'CANCEL_RELEASE',
          });
        }
      }
      // Disarm only on FULL cumulative settlement of the claim.
      if (finalSettle) {
        await this.clearClaimManagedFlags(tx, claim);
      }
    } else if (holder.managedStockDeducted || holder.managedStockReserved) {
      // Q6 (owner 2026-10-23): the product has left MANAGED_STOCK since the
      // order was placed — restore goes to the physical layer only (section
      // B below); settle the managed claim without reviving virtual stock.
      // Flags clear only when the claim is fully settled.
      await this.settleManagedClaimWithoutRestore(
        tx, claim.kind, holder, qty, reference, performedBy, finalSettle,
      );
    }

    // B. Physical engine (exact-qty on-hand restore for CONSUMED claims).
    // The restore follows the line's physical RESERVATION — its allocations
    // carry the exact warehouse the units left from — never the product's
    // default warehouse. The old `product.warehouseId` precondition silently
    // skipped the ENTIRE physical restore for products that hold warehouse
    // stock but have no default warehouse set: the return flipped to
    // RESTOCKED while no unit (and no ledger entry) ever came back
    // (staging RTN-261024-0002, 2026-10-24). restorePhysicalForReturnLine
    // already no-ops safely when no reservation exists.
    let physicalShortfall = 0;
    if (cycleId) {
      const decision = this.stockRouter.resolve(
        product.availabilityMode,
        'add',
        imEnabled,
        product.syncManagedStock ?? undefined,
      );
      if (decision.pi !== 'skip') {
        const outcome = await this.restorePhysicalForReturnLine(
          tx,
          claim.kind === 'line' ? claim.line.id : claim.snap.id,
          claim.kind === 'line' ? null : claim.snap.id,
          cycleId,
          claim.kind === 'line' ? 'ORDER_ITEM' : 'COMBO_COMPONENT',
          product, variantId, qty, reference, performedBy,
          {
            // Units of this claim already physically settled by earlier
            // returns + this return's own earlier attempt: the CONSUMED
            // walk skips already-RESTORED good units (skipQty); the
            // ACTIVE walk skips already-RELEASED settled shares, good and
            // damaged alike (skipReleaseQty).
            skipQty: claim.settledGood + claim.appliedPhysical,
            skipReleaseQty: claim.settledTotal + claim.appliedPhysical,
            finalSettle,
          },
        );
        if (!outcome.found) {
          // A live cycle routes this product to the physical layer, so a
          // fulfilled line must have a reservation. Missing = the units
          // cannot be put back — report, never silently "restore".
          physicalShortfall = qty;
          this.logger.warn(
            `restoreReturnClaim: no physical reservation for ${claim.kind} ` +
              `${claim.kind === 'line' ? claim.line.id : claim.snap.id} in cycle ${cycleId} — ` +
              `${qty} unit(s) of ${productId} could not be restored to physical stock`,
          );
        } else if (outcome.consumed) {
          physicalShortfall = Math.max(0, qty - outcome.restoredQty);
          if (physicalShortfall > 0) {
            this.logger.warn(
              `restoreReturnClaim: physical allocations covered ${outcome.restoredQty}/${qty} ` +
                `unit(s) of ${productId} — ${physicalShortfall} unit(s) could not be restored`,
            );
          }
        }
      }
    }
    return { physicalShortfall };
  }

  /**
   * Physical half of restoreReturnClaim. CONSUMED → on-hand +qty across the
   * reservation's allocations (capped walk, never past each alloc), guarded
   * held-counter release, RESTORATION ledger, costing capped at qty, then
   * RESTORED (disarm) — but ONLY when the claim is fully settled
   * (opts.finalSettle): a partial walk leaves the reservation CONSUMED so
   * the next partial return resumes it. ACTIVE → capped guarded counter
   * release only (stock never left on-hand, so nothing to add back),
   * RELEASED only on full settlement.
   *
   * opts.skipQty = units of this reservation already physically restored
   * by earlier settlements of the same claim; the walk skips that prefix
   * of the allocations so cumulative partial restores never double-add.
   *
   * Returns what actually happened so the caller can report shortfalls
   * instead of claiming a restore that never moved.
   */
  private async restorePhysicalForReturnLine(
    tx: Prisma.TransactionClient,
    lookupId: string,
    componentId: string | null,
    cycleId: string,
    referenceType: string,
    product: any,
    variantId: string | undefined,
    qty: number,
    reference: string,
    performedBy?: string,
    opts?: { skipQty?: number; skipReleaseQty?: number; finalSettle?: boolean },
  ): Promise<{ found: boolean; consumed: boolean; restoredQty: number }> {
    const reservation = componentId
      ? await tx.comboComponentPhysicalReservation.findUnique({
          where: { componentId_cycleId: { componentId, cycleId } },
          include: { allocations: true },
        })
      : await tx.physicalReservation.findUnique({
          where: { orderItemId_cycleId: { orderItemId: lookupId, cycleId } },
          include: { allocations: true },
        });
    if (!reservation) return { found: false, consumed: false, restoredQty: 0 };
    if ((reservation as any).status === 'RELEASED' || (reservation as any).status === 'RESTORED') {
      // Already settled by another path — the units are accounted for.
      return { found: true, consumed: false, restoredQty: qty };
    }

    const markHandled = (status: 'RELEASED' | 'RESTORED') =>
      componentId
        ? tx.comboComponentPhysicalReservation.update({ where: { id: (reservation as any).id }, data: { status } })
        : tx.physicalReservation.update({ where: { id: (reservation as any).id }, data: { status } });
    const finalSettle = opts?.finalSettle ?? false;

    if ((reservation as any).status === 'ACTIVE') {
      // Stock never left on-hand — release the held counter (capped), no
      // add. The walk uses a DECREMENTING remaining budget across
      // allocations (previously every allocation re-used the full qty,
      // over-releasing the counter) and skips the prefix already released
      // by earlier settlements of this claim (opts.skipReleaseQty: settled
      // good + damaged shares).
      let skip = Math.max(0, opts?.skipReleaseQty ?? 0);
      let remaining = qty;
      for (const alloc of (reservation as any).allocations ?? []) {
        if (remaining <= 0) break;
        const skipHere = Math.min((alloc as any).quantity, skip);
        skip -= skipHere;
        const capacity = (alloc as any).quantity - skipHere;
        const take = Math.min(capacity, remaining);
        if (take <= 0) continue;
        remaining -= take;
        await tx.physicalInventory.updateMany({
          where: { id: (alloc as any).physicalInventoryId, reservedQuantity: { gte: take } },
          data: { reservedQuantity: { decrement: take } },
        });
      }
      if (finalSettle) await markHandled('RELEASED');
      return { found: true, consumed: false, restoredQty: qty - remaining };
    }

    if ((reservation as any).status === 'CONSUMED') {
      let skip = Math.max(0, opts?.skipQty ?? 0);
      let remaining = qty;
      let restoredQty = 0;
      for (const alloc of (reservation as any).allocations ?? []) {
        if (remaining <= 0) break;
        const skipHere = Math.min((alloc as any).quantity, skip);
        skip -= skipHere;
        const capacity = (alloc as any).quantity - skipHere;
        const take = Math.min(capacity, remaining);
        if (take <= 0) continue;
        remaining -= take;
        restoredQty += take;
        await tx.physicalInventory.update({
          where: { id: (alloc as any).physicalInventoryId },
          data: { quantity: { increment: take } },
        });
        const releaseRes = await tx.physicalInventory.updateMany({
          where: { id: (alloc as any).physicalInventoryId, reservedQuantity: { gte: take } },
          data: { reservedQuantity: { decrement: take } },
        });
        const pi = await tx.physicalInventory.findUnique({
          where: { id: (alloc as any).physicalInventoryId },
          select: { quantity: true, reservedQuantity: true },
        });
        // REAL snapshots: the row was read AFTER the increment, so the
        // pre-restore quantity is exactly (after − take). The reserved
        // counter's before-value adds back the decrement only when the
        // guarded decrement actually applied.
        const stockAfter = pi?.quantity ?? take;
        const reservedAfter = pi?.reservedQuantity ?? 0;
        const reservedBefore =
          reservedAfter + (((releaseRes as any)?.count ?? 0) > 0 ? take : 0);
        await tx.physicalInventoryLedger.create({
          data: {
            productId: (reservation as any).productId,
            variantId: (reservation as any).variantId ?? null,
            warehouseId: (reservation as any).warehouseId,
            quantity: take,
            direction: 'IN',
            stockBefore: stockAfter,
            stockAfter,
            reservedBefore,
            reservedAfter,
            type: 'RELEASE',
            reason: reference,
            performedBy: performedBy,
          },
        });
        await tx.physicalInventoryLedger.create({
          data: {
            productId: (reservation as any).productId,
            variantId: (reservation as any).variantId ?? null,
            warehouseId: (reservation as any).warehouseId,
            quantity: take,
            direction: 'IN',
            stockBefore: stockAfter - take,
            stockAfter,
            reservedBefore,
            reservedAfter,
            type: 'RESTORATION',
            reason: reference,
            performedBy: performedBy,
          },
        });
      }
      await this.restoreCostingConsumption(
        tx, cycleId, referenceType, lookupId, qty, reference,
      );
      // Disarm ONLY on full cumulative settlement: the blanket path skips
      // non-ACTIVE/CONSUMED reservations, so marking RESTORED early would
      // strand the unrestored remainder forever (audit item 4).
      if (finalSettle) await markHandled('RESTORED');
      return { found: true, consumed: true, restoredQty };
    }

    return { found: true, consumed: false, restoredQty: 0 };
  }

  /**
   * RTN stock restoration — the exact inverse of a PARTIAL return.
   *
   * An RTN order was never an outbound stock reservation/deduction, so
   * restoreForOrder (which assumes prior deduction/reservation flags) must
   * NOT be used here. This operation restores EXACTLY the RTN item
   * quantities — nothing from the original order, nothing extra.
   *
   * Layer targeting follows the ORIGINAL order's claim evidence (audit
   * 2026-11-02, item 7):
   * - Managed leg: consults the ORIGINAL line's deducted/reserved flags
   *   (the unified path's claim logic). It adds only when the managed
   *   layer actually deducted; a product that has since moved INTO
   *   MANAGED_STOCK (was inventory-controlled at order time) gets NO
   *   phantom managed add — previously the unconditional add plus the
   *   physical restore double-restored those units.
   * - Physical leg: restores into the RESERVATION ALLOCATION warehouses
   *   of the original line (like the unified path), not
   *   `sourceWarehouseId ?? product.warehouseId`. It adds only when the
   *   physical layer actually deducted (CONSUMED reservation, or a
   *   FULFILLMENT consumption proving deduction); an ACTIVE reservation
   *   releases its hold instead. Router-SKIP modes (ALWAYS_*) legitimately
   *   require no leg.
   *
   * HONEST RESULT (audit item 7): Order.stockRestored is set ONLY when
   * every required leg ran or was legitimately not required. A required
   * leg that cannot run (no warehouse resolvable, reservation missing
   * while consumptions prove deduction, allocations short) returns
   * `{ restored: false, reason }` and stockRestored stays false — the
   * caller (RtnService) fails the finalize so the caller's transaction
   * rolls back and the finalize can be retried after the data is fixed.
   *
   * Idempotent AND durable: Order.stockRestored is checked at entry and
   * set inside the SAME transaction as the stock movement, so repeated
   * calls (scanner retries, webhook + scanner races) can never restore
   * twice. An already-restored RTN reports `{ restored: false,
   * alreadyRestored: true }`.
   */
  async restoreForReturnOrder(params: {
    rtnOrderId: string;
    performedBy?: string;
    tx: Prisma.TransactionClient;
    /** productKey → damaged units (never restocked); quantity is capped per line. */
    damageByKey?: Map<string, number>;
  }): Promise<{
    restored: boolean;
    alreadyRestored?: boolean;
    reason?: string;
  }> {
    const { rtnOrderId, performedBy, tx, damageByKey } = params;

    const rtn = await tx.order.findUnique({
      where: { id: rtnOrderId },
      include: {
        status: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                availabilityMode: true,
                manageStock: true,
                syncManagedStock: true,
                warehouseId: true,
                name: true,
              },
            },
            combo: { select: { id: true } },
          },
        },
      },
    });
    if (!rtn || rtn.kind !== 'RETURN') {
      throw new BadRequestException('Return order not found');
    }
    if (rtn.stockRestored) return { restored: false, alreadyRestored: true };

    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
    const reference = `RTN RESTORE: ${rtn.displayId}`;

    // The ORIGINAL order's stock cycle — reservations and consumptions for
    // the returned lines live there (ACTIVE first, else the earliest).
    const original = rtn.returnOfOrderId
      ? await tx.order.findUnique({ where: { id: rtn.returnOfOrderId } })
      : null;
    const cycle = original
      ? ((await tx.orderStockCycle.findFirst({
          where: { orderId: original.id, status: 'ACTIVE' },
        })) ??
        (await tx.orderStockCycle.findFirst({
          where: { orderId: original.id },
          orderBy: { createdAt: 'asc' },
        })))
      : null;
    const cycleId = cycle?.id ?? null;

    const failures: string[] = [];

    for (const item of rtn.items) {
      if (!item.productId && !item.comboId) continue;

      // Claim evidence from the ORIGINAL line the RTN item was split from.
      // A fully-returned line was DELETED by the split (its deducted claim
      // was deliberately left for this restore — see
      // RtnService.releaseHoldsForRemovedLine), so a missing line means
      // the units had been deducted.
      const origLine = item.sourceOrderItemId
        ? await tx.orderItem.findUnique({
            where: { id: item.sourceOrderItemId },
          })
        : null;
      const lineClaim = {
        deducted: origLine ? !!(origLine as any).managedStockDeducted : true,
        reserved: origLine ? !!(origLine as any).managedStockReserved : false,
      };
      const origSnaps = item.sourceOrderItemId
        ? await tx.orderItemComboComponent.findMany({
            where: { orderItemId: item.sourceOrderItemId },
          })
        : [];

      if (item.comboId) {
        const snapshots = await tx.orderItemComboComponent.findMany({
          where: { orderItemId: item.id },
          include: { product: true },
        });
        for (const snap of snapshots) {
          const damaged = Math.min(
            snap.totalQuantity,
            Math.max(0, damageByKey?.get(stockKeyOf(snap.productId, snap.variantId ?? undefined)) ?? 0),
          );
          const good = snap.totalQuantity - damaged;
          if (good <= 0) continue;
          const origSnap = (origSnaps as any[]).find(
            (s) =>
              s.productId === snap.productId &&
              (s.variantId ?? null) === (snap.variantId ?? null),
          );
          const snapClaim = origSnap
            ? {
                deducted: !!origSnap.managedStockDeducted,
                reserved: !!origSnap.managedStockReserved,
              }
            : lineClaim;
          await this.restoreManagedStock(
            tx,
            snap.product,
            snap.variantId ?? undefined,
            good,
            reference,
            performedBy,
            snapClaim,
          );
          const leg = await this.restorePhysicalStock(
            tx,
            snap.product,
            snap.variantId ?? undefined,
            good,
            item.sourceWarehouseId,
            imEnabled,
            reference,
            performedBy,
            {
              cycleId,
              referenceType: 'COMBO_COMPONENT',
              referenceId: origSnap?.id ?? null,
              claim: snapClaim,
            },
          );
          if (leg.outcome === 'failed') {
            failures.push(
              `${snap.product?.name ?? snap.productId}: ${leg.reason}`,
            );
          }
        }
        continue;
      }

      if (!item.product) continue;
      const damaged = Math.min(
        item.quantity,
        Math.max(0, damageByKey?.get(stockKeyOf(item.productId!, item.variantId ?? undefined)) ?? 0),
      );
      const good = item.quantity - damaged;
      if (good <= 0) continue;
      await this.restoreManagedStock(
        tx,
        item.product,
        item.variantId ?? undefined,
        good,
        reference,
        performedBy,
        lineClaim,
      );
      const leg = await this.restorePhysicalStock(
        tx,
        item.product,
        item.variantId ?? undefined,
        good,
        item.sourceWarehouseId,
        imEnabled,
        reference,
        performedBy,
        {
          cycleId,
          referenceType: 'ORDER_ITEM',
          referenceId: item.sourceOrderItemId ?? null,
          claim: lineClaim,
        },
      );
      if (leg.outcome === 'failed') {
        failures.push(`${item.product?.name ?? item.productId}: ${leg.reason}`);
      }
    }

    // Costing-lot restoration scoped to the original order's consumptions.
    if (original && cycleId) {
      await this.restoreCostingLotsForRtn(tx, rtn, cycleId, performedBy, damageByKey);
    }

    if (failures.length > 0) {
      // Do NOT set stockRestored: at least one required leg could not run.
      // The caller fails the finalize, rolling the whole transaction back
      // so nothing is half-restored and the finalize stays retryable.
      this.logger.warn(
        `RTN ${rtn.displayId}: stock restore incomplete — ${failures.join('; ')}`,
      );
      return { restored: false, reason: failures.join('; ') };
    }

    // Durable idempotency flag — set in the same transaction as the movement.
    await tx.order.update({
      where: { id: rtnOrderId },
      data: { stockRestored: true },
    });
    await this.cache.invalidateByPrefix('product:');
    return { restored: true };
  }

  /**
   * Managed-engine restore for an RTN quantity — claim-aware (audit item
   * 7): the authoritative StockService.operate path runs ONLY for the
   * layer the original line's flags prove engaged:
   * - deducted → `add` (ledger type RETURN, reference type RETURN);
   * - reserved-only → `release` of the hold share (on-hand never moved);
   * - neither → NO movement (the layer never engaged for these units —
   *   adding here is what double-restored IC→MANAGED_STOCK mode changes).
   * When the product has since LEFT MANAGED_STOCK, the managed claim is
   * settled via its counters only (Q6), never an add.
   */
  private async restoreManagedStock(
    tx: Prisma.TransactionClient,
    product: any,
    variantId: string | undefined,
    quantity: number,
    reference: string,
    performedBy?: string,
    claim: { deducted: boolean; reserved: boolean } = { deducted: true, reserved: false },
  ) {
    if (!product) return;
    if (product.availabilityMode !== 'MANAGED_STOCK' || !product.manageStock) {
      // Q6 settle: free the managed hold this claim carries, no add.
      if (claim.deducted) {
        await this.releaseHeldReservation(
          tx, product.id, variantId, quantity, reference, performedBy,
        );
      } else if (claim.reserved) {
        try {
          await this.stockService.operate('release', {
            productId: product.id,
            variantId,
            quantity,
            reference,
            performedBy: performedBy || 'system',
            tx,
            ledgerType: 'CANCEL_RELEASE',
          });
        } catch (e) {
          this.logger.warn(
            `RTN managed claim settle skipped (${product.id}): ${(e as Error).message}`,
          );
        }
      }
      return;
    }
    if (claim.deducted) {
      await this.stockService.operate('add', {
        productId: product.id,
        variantId,
        quantity,
        reference,
        ledgerType: 'RETURN',
        referenceType: 'RETURN',
        performedBy: performedBy || 'system',
        tx,
      });
    } else if (claim.reserved) {
      await this.stockService.operate('release', {
        productId: product.id,
        variantId,
        quantity,
        reference,
        ledgerType: 'CANCEL_RELEASE',
        referenceType: 'ORDER',
        performedBy: performedBy || 'system',
        tx,
      });
    }
    // Neither flag: the managed layer never engaged for these units.
  }

  /**
   * Physical-engine restore for an RTN quantity — reservation-aware
   * (audit item 7). Targets the ORIGINAL line's reservation allocations
   * (their warehouses), falling back to `sourceWarehouseId ??
   * product.warehouseId` ONLY for legacy orders with no stock cycle at
   * all. Reports whether the leg ran, was legitimately not required
   * (router SKIP / layer never deducted), or FAILED (required but could
   * not run) so the caller can keep stockRestored honest.
   */
  private async restorePhysicalStock(
    tx: Prisma.TransactionClient,
    product: any,
    variantId: string | undefined,
    quantity: number,
    sourceWarehouseId: string | null | undefined,
    imEnabled: boolean,
    reference: string,
    performedBy?: string,
    ctx?: {
      cycleId: string | null;
      referenceType: 'ORDER_ITEM' | 'COMBO_COMPONENT';
      referenceId: string | null;
      claim: { deducted: boolean; reserved: boolean };
    },
  ): Promise<{ outcome: 'ok' | 'not-required' | 'failed'; reason?: string }> {
    if (!product) return { outcome: 'not-required' };
    const decision = this.stockRouter.resolve(
      product.availabilityMode,
      'add',
      imEnabled,
      product.syncManagedStock ?? undefined,
    );
    if (decision.pi === 'skip') return { outcome: 'not-required' };

    const cycleId = ctx?.cycleId ?? null;
    const referenceId = ctx?.referenceId ?? null;

    if (cycleId && referenceId) {
      const reservation =
        ctx!.referenceType === 'COMBO_COMPONENT'
          ? await tx.comboComponentPhysicalReservation.findUnique({
              where: { componentId_cycleId: { componentId: referenceId, cycleId } },
              include: { allocations: true },
            })
          : await tx.physicalReservation.findUnique({
              where: { orderItemId_cycleId: { orderItemId: referenceId, cycleId } },
              include: { allocations: true },
            });
      if (reservation) {
        const status = (reservation as any).status as string;
        if (status === 'RESTORED' || status === 'RELEASED') {
          // Another path already settled the physical claim.
          return { outcome: 'ok' };
        }
        const allocations = ((reservation as any).allocations ?? []) as any[];
        if (status === 'ACTIVE') {
          // Never deducted physically — free the hold share, never add.
          let budget = quantity;
          for (const alloc of allocations) {
            if (budget <= 0) break;
            const take = Math.min(alloc.quantity, budget);
            if (take <= 0) continue;
            const res = await tx.physicalInventory.updateMany({
              where: {
                id: alloc.physicalInventoryId,
                reservedQuantity: { gte: take },
              },
              data: { reservedQuantity: { decrement: take } },
            });
            if ((res as any)?.count > 0) budget -= take;
          }
          return { outcome: 'ok' };
        }
        // CONSUMED: restore into the allocation warehouses (the exact
        // warehouses the units left from), split across allocations.
        const piIds = allocations.map((a) => a.physicalInventoryId);
        const piRows = piIds.length
          ? await tx.physicalInventory.findMany({
              where: { id: { in: piIds } },
              select: { id: true, warehouseId: true },
            })
          : [];
        const warehouseByPi = new Map<string, string>(
          (piRows as any[]).map((r) => [r.id, r.warehouseId]),
        );
        let remaining = quantity;
        for (const alloc of allocations) {
          if (remaining <= 0) break;
          const take = Math.min(alloc.quantity, remaining);
          if (take <= 0) continue;
          remaining -= take;
          await this.stockService.operatePhysical('add', {
            productId: product.id,
            variantId,
            warehouseId:
              warehouseByPi.get(alloc.physicalInventoryId) ??
              (reservation as any).warehouseId,
            quantity: take,
            reference,
            ledgerType: 'RESTORATION',
            referenceType: 'RETURN',
            performedBy: performedBy || 'system',
            tx,
          });
        }
        if (remaining > 0) {
          return {
            outcome: 'failed',
            reason:
              `physical allocations cover ${quantity - remaining}/${quantity} unit(s); ` +
              `${remaining} unit(s) have no allocation to restore into`,
          };
        }
        return { outcome: 'ok' };
      }

      // No reservation: did the physical layer deduct at all? A FULFILLMENT
      // consumption for this line proves it did — restoring blind would
      // fabricate stock, so the leg fails honestly. No consumption → the
      // layer never engaged → not required.
      const consumption = await tx.costingLotConsumption.findFirst({
        where: {
          cycleId,
          referenceType: ctx!.referenceType,
          referenceId,
          type: 'FULFILLMENT',
        },
        select: { id: true },
      });
      if (consumption) {
        return {
          outcome: 'failed',
          reason:
            'physical stock was deducted (costing consumption exists) but the ' +
            'physical reservation is missing — cannot restore without it',
        };
      }
      return { outcome: 'not-required' };
    }

    // Legacy path: the original order has no stock cycle (or the RTN item
    // is not linked to an original line), so no reservation evidence can
    // exist. Restore only when the claim shows the units were deducted,
    // into the line's source warehouse / product default.
    if (!ctx?.claim?.deducted) return { outcome: 'not-required' };
    const warehouseId = sourceWarehouseId ?? product.warehouseId;
    if (!warehouseId) {
      return {
        outcome: 'failed',
        reason: 'no warehouse resolvable for the physical restore',
      };
    }
    await this.stockService.operatePhysical('add', {
      productId: product.id,
      variantId,
      warehouseId,
      quantity,
      reference,
      ledgerType: 'RESTORATION',
      referenceType: 'RETURN',
      performedBy: performedBy || 'system',
      tx,
    });
    return { outcome: 'ok' };
  }

  /**
   * Costing-lot restoration for an RTN order. Walks the ORIGINAL order's
   * FULFILLMENT consumptions (linked through each RTN item's
   * sourceOrderItemId) and restores exactly the returned quantities.
   * Idempotent via CostingLotRestoration's @@unique([consumptionId,
   * returnReferenceId]) — a repeated call finds the restoration already
   * there and restores nothing.
   */
  private async restoreCostingLotsForRtn(
    tx: Prisma.TransactionClient,
    rtn: any,
    cycleId: string,
    performedBy?: string,
    damageByKey?: Map<string, number>,
  ) {
    const returnReferenceId = `rtn-${rtn.id}`;

    for (const item of rtn.items) {
      if (!item.sourceOrderItemId) continue;

      if (item.comboId) {
        const originalSnapshots = await tx.orderItemComboComponent.findMany({
          where: { orderItemId: item.sourceOrderItemId },
        });
        for (const snap of originalSnapshots) {
          const damaged = Math.min(
            snap.unitQuantity * item.quantity,
            Math.max(
              0,
              damageByKey?.get(
                stockKeyOf(snap.productId, snap.variantId ?? undefined),
              ) ?? 0,
            ),
          );
          const wanted = snap.unitQuantity * item.quantity - damaged;
          await this.restoreCostingConsumption(
            tx,
            cycleId,
            'COMBO_COMPONENT',
            snap.id,
            wanted,
            returnReferenceId,
          );
        }
        continue;
      }

      const damaged = Math.min(
        item.quantity,
        Math.max(
          0,
          damageByKey?.get(
            stockKeyOf(item.productId, item.variantId ?? undefined),
          ) ?? 0,
        ),
      );
      await this.restoreCostingConsumption(
        tx,
        cycleId,
        'ORDER_ITEM',
        item.sourceOrderItemId,
        item.quantity - damaged,
        returnReferenceId,
      );
    }
  }

  private async restoreCostingConsumption(
    tx: Prisma.TransactionClient,
    cycleId: string,
    referenceType: string,
    referenceId: string,
    wanted: number,
    returnReferenceId: string,
  ) {
    if (wanted <= 0) return;
    const consumption = await tx.costingLotConsumption.findFirst({
      where: { cycleId, referenceType, referenceId, type: 'FULFILLMENT' },
      include: { restorations: { select: { quantity: true } } },
    });
    if (!consumption) return;

    const restoredQty = consumption.restorations.reduce(
      (sum, r) => sum + r.quantity,
      0,
    );
    const remaining = consumption.quantity - restoredQty;
    if (remaining <= 0) return;

    const quantity = Math.min(remaining, wanted);
    await tx.costingLotRestoration.create({
      data: {
        consumptionId: consumption.id,
        cycleId,
        returnReferenceId,
        quantity,
        unitCost: consumption.unitCost,
      },
    });
    await tx.costingLot.update({
      where: { id: consumption.costingLotId },
      data: { remainingQty: { increment: quantity } },
    });
    this.logger.debug(
      `CostingLot ${consumption.costingLotId} restored +${quantity} for RTN ${returnReferenceId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private: Combo Item restoration
  // ---------------------------------------------------------------------------

  private async restoreComboItem(
    tx: Prisma.TransactionClient,
    item: any,
    cycleId: string | null,
    imEnabled: boolean,
    reference: string,
    performedBy?: string,
    takeSettled?: (
      productId: string,
      variantId: string | null | undefined,
      claimQty: number,
    ) => { good: number; total: number },
  ): Promise<void> {
    // Attempt snapshot-based restore
    const snapshots = await tx.orderItemComboComponent.findMany({
      where: { orderItemId: item.id },
      include: { product: true },
    });

    if (snapshots.length === 0) {
      // Legacy: no snapshot exists — log and skip for manual review
      this.logger.warn(
        `[LEGACY] Combo OrderItem ${item.id} has no OrderItemComboComponent snapshots. ` +
          `Manual review required. Skipping automatic physical restoration.`,
      );
      // Still attempt managed stock restore via parent item flags (best-effort)
      await this.restoreManagedFromItemFlags(tx, item, reference, performedBy);
      return;
    }

    const referencePrefix = reference.startsWith('cancel')
      ? 'cancel'
      : 'return';

    for (const snap of snapshots) {
      const compProduct = snap.product;
      // Units of this snapshot already settled by item-level Returns.
      const settled = takeSettled
        ? takeSettled(snap.productId, snap.variantId, snap.totalQuantity)
        : { good: 0, total: 0 };
      const effectiveQty = Math.max(0, snap.totalQuantity - settled.total);

      // A. Managed Engine
      if (
        compProduct.availabilityMode === 'MANAGED_STOCK' &&
        compProduct.manageStock
      ) {
        if (effectiveQty <= 0) {
          // Fully settled by item-level returns — disarm only.
          await tx.orderItemComboComponent.update({
            where: { id: snap.id },
            data: { managedStockDeducted: false, managedStockReserved: false },
          });
        } else if (snap.managedStockDeducted) {
          await this.stockService.operate('add', {
            productId: snap.productId,
            variantId: snap.variantId ?? undefined,
            quantity: effectiveQty,
            reference,
            performedBy: performedBy || 'system',
            tx,
            ledgerType:
              referencePrefix === 'cancel' ? 'CANCEL_RELEASE' : 'RETURN',
          });
          await this.releaseHeldReservation(
            tx,
            snap.productId,
            snap.variantId ?? undefined,
            effectiveQty,
            reference,
            performedBy,
          );
          await tx.orderItemComboComponent.update({
            where: { id: snap.id },
            data: { managedStockDeducted: false, managedStockReserved: false },
          });
        } else if (snap.managedStockReserved) {
          await this.stockService.operate('release', {
            productId: snap.productId,
            variantId: snap.variantId ?? undefined,
            quantity: effectiveQty,
            reference,
            performedBy: performedBy || 'system',
            tx,
            ledgerType: 'CANCEL_RELEASE',
          });
          await tx.orderItemComboComponent.update({
            where: { id: snap.id },
            data: { managedStockReserved: false },
          });
        }
      } else if (snap.managedStockDeducted || snap.managedStockReserved) {
        // Q6 (owner 2026-10-23): product left MANAGED_STOCK — physical only.
        await this.settleManagedClaimWithoutRestore(
          tx, 'snap', snap, effectiveQty, reference, performedBy,
        );
      }

      // B. Physical Engine
      if (cycleId) {
        const decision = this.stockRouter.resolve(
          compProduct.availabilityMode,
          'add',
          imEnabled,
          compProduct.syncManagedStock ?? undefined,
        );
        if (decision.pi !== 'skip') {
          await this.restorePhysicalForComponent(
            tx,
            snap.id,
            cycleId,
            'COMBO_COMPONENT',
            reference,
            performedBy,
            {
              skipQty: settled.good,
              skipReleaseQty: settled.total,
              maxQty: effectiveQty,
            },
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Standalone Item restoration
  // ---------------------------------------------------------------------------

  private async restoreStandaloneItem(
    tx: Prisma.TransactionClient,
    item: any,
    cycleId: string | null,
    imEnabled: boolean,
    reference: string,
    performedBy?: string,
    settled: { good: number; total: number } = { good: 0, total: 0 },
  ): Promise<void> {
    const product = item.product;
    if (!product) return;

    const referencePrefix = reference.startsWith('cancel')
      ? 'cancel'
      : 'return';
    // Units already settled by item-level Returns never restore twice;
    // this blanket pass settles only the remainder.
    const effectiveQty = Math.max(0, item.quantity - settled.total);

    // A. Managed Engine
    if (product.availabilityMode === 'MANAGED_STOCK' && product.manageStock) {
      if (effectiveQty <= 0) {
        // Fully settled by item-level returns — disarm only.
        if (item.managedStockDeducted || item.managedStockReserved) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { managedStockDeducted: false, managedStockReserved: false },
          });
        }
      } else if (item.managedStockDeducted) {
        await this.stockService.operate('add', {
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          quantity: effectiveQty,
          reference,
          performedBy: performedBy || 'system',
          tx,
          ledgerType:
            referencePrefix === 'cancel' ? 'CANCEL_RELEASE' : 'RETURN',
        });
        await this.releaseHeldReservation(
          tx,
          item.productId,
          item.variantId ?? undefined,
          effectiveQty,
          reference,
          performedBy,
        );
        await tx.orderItem.update({
          where: { id: item.id },
          data: { managedStockDeducted: false, managedStockReserved: false },
        });
      } else if (item.managedStockReserved) {
        await this.stockService.operate('release', {
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          quantity: effectiveQty,
          reference,
          performedBy: performedBy || 'system',
          tx,
          ledgerType: 'CANCEL_RELEASE',
        });
        await tx.orderItem.update({
          where: { id: item.id },
          data: { managedStockReserved: false },
        });
      }
    } else if (item.managedStockDeducted || item.managedStockReserved) {
      // Q6 (owner 2026-10-23): product left MANAGED_STOCK — physical only.
      await this.settleManagedClaimWithoutRestore(
        tx, 'line', item, effectiveQty, reference, performedBy,
      );
    }

    // B. Physical Engine
    if (cycleId) {
      const decision = this.stockRouter.resolve(
        product.availabilityMode,
        'add',
        imEnabled,
        product.syncManagedStock ?? undefined,
      );
      if (decision.pi !== 'skip') {
        await this.restorePhysicalForItem(
          tx,
          item.id,
          cycleId,
          'ORDER_ITEM',
          reference,
          performedBy,
          {
            skipQty: settled.good,
            skipReleaseQty: settled.total,
            maxQty: effectiveQty,
          },
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Physical Reservation restore for a standalone OrderItem
  // ---------------------------------------------------------------------------

  /**
   * Managed-engine: release the reservation that was re-established by
   * 'Return Pending' (or that legitimately survived cancellation). Runs only
   * when the counter actually holds the quantity — a full dedup with the
   * ledger would be racy, the guarded decrement is the source of truth.
   */
  private async releaseHeldReservation(
    tx: Prisma.TransactionClient,
    productId: string,
    variantId: string | undefined,
    quantity: number,
    reference: string,
    performedBy?: string,
  ) {
    try {
      await this.stockService.operate('release', {
        productId,
        variantId,
        quantity,
        reference,
        performedBy: performedBy || 'system',
        tx,
        ledgerType: 'RELEASE',
        referenceType: 'ORDER',
      });
    } catch (e) {
      // Not an error: counter may already be 0 (legacy orders deducted before
      // this rule, or a second pass). Restore of ON-hand still happened above.
      this.logger.log(
        `releaseHeldReservation: no held reservation to release (${productId}) — ${(e as Error).message}`,
      );
    }
  }

  private async restorePhysicalForItem(
    tx: Prisma.TransactionClient,
    orderItemId: string,
    cycleId: string,
    referenceType: string,
    reference: string,
    performedBy?: string,
    opts?: { skipQty?: number; skipReleaseQty?: number; maxQty?: number },
  ): Promise<void> {
    const reservation = await tx.physicalReservation.findUnique({
      where: { orderItemId_cycleId: { orderItemId, cycleId } },
      include: { allocations: true },
    });

    if (!reservation) return;
    if (reservation.status === 'RELEASED' || reservation.status === 'RESTORED')
      return;

    if (reservation.status === 'ACTIVE') {
      // Release: decrement reservedQuantity for the UNSETTLED remainder
      // only (settled shares were already released by the item-level
      // path), then mark RELEASED — this blanket pass is terminal.
      let skip = Math.max(0, opts?.skipReleaseQty ?? 0);
      let budget = Math.max(0, opts?.maxQty ?? Number.POSITIVE_INFINITY);
      for (const alloc of reservation.allocations) {
        if (budget <= 0) break;
        const skipHere = Math.min(alloc.quantity, skip);
        skip -= skipHere;
        const take = Math.min(alloc.quantity - skipHere, budget);
        if (take <= 0) continue;
        budget -= take;
        await tx.physicalInventory.update({
          where: { id: alloc.physicalInventoryId },
          data: { reservedQuantity: { decrement: take } },
        });
      }
      await tx.physicalReservation.update({
        where: { id: reservation.id },
        data: { status: 'RELEASED' },
      });
      return;
    }

    if (reservation.status === 'CONSUMED') {
      // Restore: increment quantity AND release the counter that the
      // 'Return Pending' hold re-established (or that survived deduction).
      // Guarded decrement keeps the invariant safe on re-runs. Units
      // already restored by item-level Returns (skipQty) are skipped and
      // at most maxQty further units restore — the settled remainder.
      let skip = Math.max(0, opts?.skipQty ?? 0);
      let budget = Math.max(0, opts?.maxQty ?? Number.POSITIVE_INFINITY);
      for (const alloc of reservation.allocations) {
        if (budget <= 0) break;
        const skipHere = Math.min(alloc.quantity, skip);
        skip -= skipHere;
        const take = Math.min(alloc.quantity - skipHere, budget);
        if (take <= 0) continue;
        budget -= take;
        await tx.physicalInventory.update({
          where: { id: alloc.physicalInventoryId },
          data: { quantity: { increment: take } },
        });
        const releaseRes = await tx.physicalInventory.updateMany({
          where: {
            id: alloc.physicalInventoryId,
            reservedQuantity: { gte: take },
          },
          data: { reservedQuantity: { decrement: take } },
        });
        const pi = await tx.physicalInventory.findUnique({
          where: { id: alloc.physicalInventoryId },
          select: { quantity: true, reservedQuantity: true },
        });
        // REAL snapshots (row read after the increment): before = after − take.
        const stockAfter = pi?.quantity ?? take;
        const reservedAfter = pi?.reservedQuantity ?? 0;
        const reservedBefore =
          reservedAfter + (((releaseRes as any)?.count ?? 0) > 0 ? take : 0);
        await tx.physicalInventoryLedger.create({
          data: {
            productId: reservation.productId,
            variantId: reservation.variantId ?? null,
            warehouseId: reservation.warehouseId,
            quantity: take,
            direction: 'IN',
            stockBefore: stockAfter,
            stockAfter,
            reservedBefore,
            reservedAfter,
            type: 'RELEASE',
            reason: reference,
            performedBy: performedBy,
          },
        });
        await tx.physicalInventoryLedger.create({
          data: {
            productId: reservation.productId,
            variantId: reservation.variantId ?? null,
            warehouseId: reservation.warehouseId,
            quantity: take,
            direction: 'IN',
            stockBefore: stockAfter - take,
            stockAfter,
            reservedBefore,
            reservedAfter,
            type: 'RESTORATION',
            reason: reference,
            performedBy: performedBy,
          },
        });
      }
      await tx.physicalReservation.update({
        where: { id: reservation.id },
        data: { status: 'RESTORED' },
      });

      // Cycle-safe costing lot restore
      await this.restoreCostingLotsForCycle(
        tx,
        cycleId,
        referenceType,
        orderItemId,
        reference,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Physical Reservation restore for a combo component
  // ---------------------------------------------------------------------------

  private async restorePhysicalForComponent(
    tx: Prisma.TransactionClient,
    componentId: string,
    cycleId: string,
    referenceType: string,
    reference: string,
    performedBy?: string,
    opts?: { skipQty?: number; skipReleaseQty?: number; maxQty?: number },
  ): Promise<void> {
    const reservation = await tx.comboComponentPhysicalReservation.findUnique({
      where: { componentId_cycleId: { componentId, cycleId } },
      include: { allocations: true },
    });

    if (!reservation) return;
    if (reservation.status === 'RELEASED' || reservation.status === 'RESTORED')
      return;

    if (reservation.status === 'ACTIVE') {
      let skip = Math.max(0, opts?.skipReleaseQty ?? 0);
      let budget = Math.max(0, opts?.maxQty ?? Number.POSITIVE_INFINITY);
      for (const alloc of reservation.allocations) {
        if (budget <= 0) break;
        const skipHere = Math.min(alloc.quantity, skip);
        skip -= skipHere;
        const take = Math.min(alloc.quantity - skipHere, budget);
        if (take <= 0) continue;
        budget -= take;
        await tx.physicalInventory.update({
          where: { id: alloc.physicalInventoryId },
          data: { reservedQuantity: { decrement: take } },
        });
      }
      await tx.comboComponentPhysicalReservation.update({
        where: { id: reservation.id },
        data: { status: 'RELEASED' },
      });
      return;
    }

    if (reservation.status === 'CONSUMED') {
      let skip = Math.max(0, opts?.skipQty ?? 0);
      let budget = Math.max(0, opts?.maxQty ?? Number.POSITIVE_INFINITY);
      for (const alloc of reservation.allocations) {
        if (budget <= 0) break;
        const skipHere = Math.min(alloc.quantity, skip);
        skip -= skipHere;
        const take = Math.min(alloc.quantity - skipHere, budget);
        if (take <= 0) continue;
        budget -= take;
        await tx.physicalInventory.update({
          where: { id: alloc.physicalInventoryId },
          data: { quantity: { increment: take } },
        });
        const pi = await tx.physicalInventory.findUnique({
          where: { id: alloc.physicalInventoryId },
          select: { quantity: true, reservedQuantity: true },
        });
        // REAL snapshots (row read after the increment): before = after − take.
        const stockAfter = pi?.quantity ?? take;
        await tx.physicalInventoryLedger.create({
          data: {
            productId: reservation.productId,
            variantId: reservation.variantId ?? null,
            warehouseId: reservation.warehouseId,
            quantity: take,
            direction: 'IN',
            stockBefore: stockAfter - take,
            stockAfter,
            reservedBefore: pi?.reservedQuantity ?? null,
            reservedAfter: pi?.reservedQuantity ?? null,
            type: 'RESTORATION',
            reason: reference,
            performedBy: performedBy,
          },
        });
      }
      await tx.comboComponentPhysicalReservation.update({
        where: { id: reservation.id },
        data: { status: 'RESTORED' },
      });

      await this.restoreCostingLotsForCycle(
        tx,
        cycleId,
        referenceType,
        componentId,
        reference,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Cycle-scoped costing lot restoration (exact inverse)
  // ---------------------------------------------------------------------------

  private async restoreCostingLotsForCycle(
    tx: Prisma.TransactionClient,
    cycleId: string,
    referenceType: string,
    referenceId: string,
    reference: string,
  ): Promise<void> {
    const consumptions = await tx.costingLotConsumption.findMany({
      where: {
        cycleId,
        referenceType,
        referenceId,
        type: 'FULFILLMENT',
      },
      include: { restorations: { select: { quantity: true } } },
    });

    for (const consumption of consumptions) {
      const restoredQty = consumption.restorations.reduce(
        (sum, r) => sum + r.quantity,
        0,
      );
      const remaining = consumption.quantity - restoredQty;
      if (remaining <= 0) continue;

      // Create restoration record linked to same cycleId for audit
      await tx.costingLotRestoration.create({
        data: {
          consumptionId: consumption.id,
          cycleId,
          returnReferenceId: `reversal-${cycleId}`,
          quantity: remaining,
          unitCost: consumption.unitCost,
        },
      });

      // Restore costing lot balance (LIFO-safe: we add back to the exact lot consumed)
      await tx.costingLot.update({
        where: { id: consumption.costingLotId },
        data: { remainingQty: { increment: remaining } },
      });

      this.logger.debug(
        `CostingLot ${consumption.costingLotId} restored +${remaining} for cycle ${cycleId} ref ${referenceId}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Legacy fallback — restore managed stock from parent OrderItem flags
  // ---------------------------------------------------------------------------

  private async restoreManagedFromItemFlags(
    tx: Prisma.TransactionClient,
    item: any,
    reference: string,
    performedBy?: string,
  ): Promise<void> {
    const product = item.product;
    if (!product) return;
    if (product.availabilityMode !== 'MANAGED_STOCK' || !product.manageStock) {
      // Q6 (owner 2026-10-23): product left MANAGED_STOCK — settle the
      // managed claim (flags + hold) without reviving virtual stock.
      if (item.managedStockDeducted || item.managedStockReserved) {
        await this.settleManagedClaimWithoutRestore(
          tx, 'line', item, item.quantity, reference, performedBy,
        );
      }
      return;
    }

    const referencePrefix = reference.startsWith('cancel')
      ? 'cancel'
      : 'return';

    if (item.managedStockDeducted) {
      await this.stockService.operate('add', {
        productId: item.productId,
        variantId: item.variantId ?? undefined,
        quantity: item.quantity,
        reference: `${reference}-legacy-combo`,
        performedBy: performedBy || 'system',
        tx,
        ledgerType: referencePrefix === 'cancel' ? 'CANCEL_RELEASE' : 'RETURN',
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: { managedStockDeducted: false, managedStockReserved: false },
      });
    } else if (item.managedStockReserved) {
      await this.stockService.operate('release', {
        productId: item.productId,
        variantId: item.variantId ?? undefined,
        quantity: item.quantity,
        reference: `${reference}-legacy-combo`,
        performedBy: performedBy || 'system',
        tx,
        ledgerType: 'CANCEL_RELEASE',
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: { managedStockReserved: false },
      });
    }
  }
}
