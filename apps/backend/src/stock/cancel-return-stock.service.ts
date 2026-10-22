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
  }): Promise<{ restored: Array<{ productId: string; variantId: string | null; quantity: number }> }> {
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
    if (!order) return { restored: [] };

    // ---- Build matchable claims: standalone lines + combo snapshots --------
    type Claim =
      | { kind: 'line'; line: any; product: any; remaining: number }
      | { kind: 'snap'; line: any; snap: any; product: any; remaining: number };
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
            remaining: snap.totalQuantity,
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
        remaining: line.quantity,
      };
      allClaims.push(claim);
      const k = keyOf(line.productId, line.variantId ?? undefined);
      if (!claimsByKey.has(k)) claimsByKey.set(k, []);
      claimsByKey.get(k)!.push(claim);
    }

    // ---- Allocate Return quantities across matching claims (FIFO) ----------
    const restoredByKey = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
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
        if (goodTake > 0) {
          await this.restoreReturnClaim(tx, claim, goodTake, cycleId, imEnabled, reference, performedBy);
          const agg = restoredByKey.get(k) ?? {
            productId: item.productId,
            variantId: (item.variantId ?? null) as string | null,
            quantity: 0,
          };
          agg.quantity += goodTake;
          restoredByKey.set(k, agg);
        } else {
          // Damaged-only allocation still disarms the claim: a later blanket
          // restore must never put these units back on the shelf.
          await this.disarmClaim(tx, claim);
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
    return { restored: [...restoredByKey.values()] };
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
   * Damaged-only allocation: the claim is settled (nothing will ever restock)
   * but no stock movement is written. Clearing the managed flags and marking
   * the physical reservation handled keeps the blanket restore path from
   * resurrecting units that arrived damaged.
   */
  private async disarmClaim(
    tx: Prisma.TransactionClient,
    claim:
      | { kind: 'line'; line: any; product: any; remaining: number }
      | { kind: 'snap'; line: any; snap: any; product: any; remaining: number },
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

  /**
   * Restore + disarm ONE allocated claim (see restoreForReturnItems).
   * Managed: exact-qty `add` when deducted (plus a capped release of the
   * Return-Pending hold), capped `release` when reserved-only; flags cleared
   * so a later blanket restore skips this claim. Physical: exact-qty on-hand
   * restore for CONSUMED reservations (capped `release` of the held counter
   * for ACTIVE ones); the reservation is marked handled so the blanket path
   * — which skips non-ACTIVE/CONSUMED reservations — can never re-restore.
   */
  private async restoreReturnClaim(
    tx: Prisma.TransactionClient,
    claim:
      | { kind: 'line'; line: any; product: any; remaining: number }
      | { kind: 'snap'; line: any; snap: any; product: any; remaining: number },
    qty: number,
    cycleId: string | null,
    imEnabled: boolean,
    reference: string,
    performedBy?: string,
  ): Promise<void> {
    if (qty <= 0) return;
    const product = claim.product;
    const holder = claim.kind === 'line' ? claim.line : claim.snap;
    const productId = (claim.kind === 'line' ? claim.line.productId : claim.snap.productId) as string;
    const variantId = (claim.kind === 'line' ? claim.line.variantId : claim.snap.variantId) ?? undefined;
    if (!product) return;

    // A. Managed engine (exact-qty direct adds — RTN-path semantics).
    if (product.availabilityMode === 'MANAGED_STOCK' && product.manageStock) {
      if (holder.managedStockDeducted) {
        await this.stockService.operate('add', {
          productId,
          variantId,
          quantity: qty,
          reference,
          performedBy: performedBy || 'system',
          tx,
          ledgerType: 'RETURN',
          referenceType: 'RETURN',
        });
        // Capped release of the Return-Pending hold (remainder stays held).
        await this.releaseHeldReservation(tx, productId, variantId, qty, reference, performedBy);
      } else if (holder.managedStockReserved) {
        await this.stockService.operate('release', {
          productId,
          variantId,
          quantity: qty,
          reference,
          performedBy: performedBy || 'system',
          tx,
          ledgerType: 'CANCEL_RELEASE',
        });
      }
      // Disarm: this claim is settled — the blanket path must skip it.
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

    // B. Physical engine (exact-qty on-hand restore for CONSUMED claims).
    if (cycleId && product.warehouseId) {
      const decision = this.stockRouter.resolve(
        product.availabilityMode,
        'add',
        imEnabled,
        product.syncManagedStock ?? undefined,
      );
      if (decision.pi !== 'skip') {
        if (claim.kind === 'line') {
          await this.restorePhysicalForReturnLine(
            tx, claim.line.id, null, cycleId, 'ORDER_ITEM',
            product, variantId, qty, reference, performedBy,
          );
        } else {
          await this.restorePhysicalForReturnLine(
            tx, claim.snap.id, claim.snap.id, cycleId, 'COMBO_COMPONENT',
            product, variantId, qty, reference, performedBy,
          );
        }
      }
    }
  }

  /**
   * Physical half of restoreReturnClaim. CONSUMED → on-hand +qty across the
   * reservation's allocations (capped walk, never past each alloc), guarded
   * held-counter release, RESTORATION ledger, costing capped at qty, then
   * RESTORED (disarm). ACTIVE → capped guarded counter release only (stock
   * never left on-hand, so nothing to add back), RELEASED only on full
   * coverage of the reservation.
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
  ): Promise<void> {
    const reservation = componentId
      ? await tx.comboComponentPhysicalReservation.findUnique({
          where: { componentId_cycleId: { componentId, cycleId } },
          include: { allocations: true },
        })
      : await tx.physicalReservation.findUnique({
          where: { orderItemId_cycleId: { orderItemId: lookupId, cycleId } },
          include: { allocations: true },
        });
    if (!reservation) return;
    if ((reservation as any).status === 'RELEASED' || (reservation as any).status === 'RESTORED') return;

    const markHandled = (status: 'RELEASED' | 'RESTORED') =>
      componentId
        ? tx.comboComponentPhysicalReservation.update({ where: { id: (reservation as any).id }, data: { status } })
        : tx.physicalReservation.update({ where: { id: (reservation as any).id }, data: { status } });

    if ((reservation as any).status === 'ACTIVE') {
      // Stock never left on-hand — release the held counter (capped), no add.
      for (const alloc of (reservation as any).allocations ?? []) {
        const take = Math.min((alloc as any).quantity, qty);
        if (take <= 0) continue;
        await tx.physicalInventory.updateMany({
          where: { id: (alloc as any).physicalInventoryId, reservedQuantity: { gte: take } },
          data: { reservedQuantity: { decrement: take } },
        });
      }
      const total = ((reservation as any).allocations ?? []).reduce(
        (s: number, a: any) => s + (a.quantity ?? 0), 0,
      );
      if (qty >= total) await markHandled('RELEASED');
      return;
    }

    if ((reservation as any).status === 'CONSUMED') {
      let remaining = qty;
      for (const alloc of (reservation as any).allocations ?? []) {
        if (remaining <= 0) break;
        const take = Math.min((alloc as any).quantity, remaining);
        if (take <= 0) continue;
        remaining -= take;
        await tx.physicalInventory.update({
          where: { id: (alloc as any).physicalInventoryId },
          data: { quantity: { increment: take } },
        });
        await tx.physicalInventory.updateMany({
          where: { id: (alloc as any).physicalInventoryId, reservedQuantity: { gte: take } },
          data: { reservedQuantity: { decrement: take } },
        });
        const pi = await tx.physicalInventory.findUnique({
          where: { id: (alloc as any).physicalInventoryId },
          select: { quantity: true, reservedQuantity: true },
        });
        await tx.physicalInventoryLedger.create({
          data: {
            productId: (reservation as any).productId,
            variantId: (reservation as any).variantId ?? null,
            warehouseId: (reservation as any).warehouseId,
            quantity: take,
            direction: 'IN',
            stockBefore: pi?.quantity ?? take,
            stockAfter: pi?.quantity ?? take,
            reservedBefore: (pi?.reservedQuantity ?? 0) + take,
            reservedAfter: pi?.reservedQuantity ?? 0,
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
            stockBefore: 0,
            stockAfter: take,
            type: 'RESTORATION',
            reason: reference,
            performedBy: performedBy,
          },
        });
      }
      await this.restoreCostingConsumption(
        tx, cycleId, referenceType, lookupId, qty, reference,
      );
      // Disarm: the blanket path skips non-ACTIVE/CONSUMED reservations, so
      // this claim can never re-restore; later arrivals use this same path.
      await markHandled('RESTORED');
    }
  }

  /**
   * RTN stock restoration — the exact inverse of a PARTIAL return.
   *
   * An RTN order was never an outbound stock reservation/deduction, so
   * restoreForOrder (which assumes prior deduction/reservation flags) must
   * NOT be used here. This operation restores EXACTLY the RTN item
   * quantities — nothing from the original order, nothing extra.
   *
   * Managed engine:  stockService.operate('add', RETURN)
   * Physical engine: stockService.operatePhysical('add') — authoritative path
   * Costing engine:  CostingLotRestoration rows scoped to the ORIGINAL order's
   *                  FULFILLMENT consumptions (linked via sourceOrderItemId)
   *
   * Idempotent AND durable: Order.stockRestored is checked at entry and set
   * inside the SAME transaction as the stock movement, so repeated calls
   * (scanner retries, webhook + scanner races) can never restore twice.
   */
  async restoreForReturnOrder(params: {
    rtnOrderId: string;
    performedBy?: string;
    tx: Prisma.TransactionClient;
    /** productKey → damaged units (never restocked); quantity is capped per line. */
    damageByKey?: Map<string, number>;
  }): Promise<{ restored: boolean }> {
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
    if (rtn.stockRestored) return { restored: false };

    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
    const reference = `RTN RESTORE: ${rtn.displayId}`;

    for (const item of rtn.items) {
      if (!item.productId && !item.comboId) continue;

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
          await this.restoreManagedStock(
            tx,
            snap.product,
            snap.variantId ?? undefined,
            good,
            reference,
            performedBy,
          );
          await this.restorePhysicalStock(
            tx,
            snap.product,
            snap.variantId ?? undefined,
            good,
            item.sourceWarehouseId,
            imEnabled,
            reference,
            performedBy,
          );
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
      );
      await this.restorePhysicalStock(
        tx,
        item.product,
        item.variantId ?? undefined,
        good,
        item.sourceWarehouseId,
        imEnabled,
        reference,
        performedBy,
      );
    }

    // Costing-lot restoration scoped to the original order's consumptions.
    const original = rtn.returnOfOrderId
      ? await tx.order.findUnique({ where: { id: rtn.returnOfOrderId } })
      : null;
    if (original) {
      const cycle = await tx.orderStockCycle.findFirst({
        where: { orderId: original.id },
        orderBy: { createdAt: 'asc' },
      });
      if (cycle) {
        await this.restoreCostingLotsForRtn(tx, rtn, cycle.id, performedBy, damageByKey);
      }
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
   * Managed-engine restore for an RTN quantity. Uses the authoritative
   * StockService.operate path (ledger type RETURN, reference type RETURN).
   */
  private async restoreManagedStock(
    tx: Prisma.TransactionClient,
    product: any,
    variantId: string | undefined,
    quantity: number,
    reference: string,
    performedBy?: string,
  ) {
    if (!product) return;
    if (product.availabilityMode !== 'MANAGED_STOCK' || !product.manageStock)
      return;
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
  }

  /**
   * Physical-engine restore for an RTN quantity. Uses the authoritative
   * operatePhysical path (finds/creates the warehouse-level PI row). Guarded
   * by the same router decision the forward flow uses.
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
  ) {
    if (!product) return;
    const decision = this.stockRouter.resolve(
      product.availabilityMode,
      'add',
      imEnabled,
      product.syncManagedStock ?? undefined,
    );
    if (decision.pi === 'skip') return;
    const warehouseId = sourceWarehouseId ?? product.warehouseId;
    if (!warehouseId) return;
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

      // A. Managed Engine
      if (
        compProduct.availabilityMode === 'MANAGED_STOCK' &&
        compProduct.manageStock
      ) {
        if (snap.managedStockDeducted) {
          await this.stockService.operate('add', {
            productId: snap.productId,
            variantId: snap.variantId ?? undefined,
            quantity: snap.totalQuantity,
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
            snap.totalQuantity,
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
            quantity: snap.totalQuantity,
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
  ): Promise<void> {
    const product = item.product;
    if (!product) return;

    const referencePrefix = reference.startsWith('cancel')
      ? 'cancel'
      : 'return';

    // A. Managed Engine
    if (product.availabilityMode === 'MANAGED_STOCK' && product.manageStock) {
      if (item.managedStockDeducted) {
        await this.stockService.operate('add', {
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          quantity: item.quantity,
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
          item.quantity,
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
          quantity: item.quantity,
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
  ): Promise<void> {
    const reservation = await tx.physicalReservation.findUnique({
      where: { orderItemId_cycleId: { orderItemId, cycleId } },
      include: { allocations: true },
    });

    if (!reservation) return;
    if (reservation.status === 'RELEASED' || reservation.status === 'RESTORED')
      return;

    if (reservation.status === 'ACTIVE') {
      // Release: decrement reservedQuantity, mark RELEASED
      for (const alloc of reservation.allocations) {
        await tx.physicalInventory.update({
          where: { id: alloc.physicalInventoryId },
          data: { reservedQuantity: { decrement: alloc.quantity } },
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
      // Guarded decrement keeps the invariant safe on re-runs.
      for (const alloc of reservation.allocations) {
        await tx.physicalInventory.update({
          where: { id: alloc.physicalInventoryId },
          data: { quantity: { increment: alloc.quantity } },
        });
        await tx.physicalInventory.updateMany({
          where: {
            id: alloc.physicalInventoryId,
            reservedQuantity: { gte: alloc.quantity },
          },
          data: { reservedQuantity: { decrement: alloc.quantity } },
        });
        const pi = await tx.physicalInventory.findUnique({
          where: { id: alloc.physicalInventoryId },
          select: { quantity: true, reservedQuantity: true },
        });
        await tx.physicalInventoryLedger.create({
          data: {
            productId: reservation.productId,
            variantId: reservation.variantId ?? null,
            warehouseId: reservation.warehouseId,
            quantity: alloc.quantity,
            direction: 'IN',
            stockBefore: pi?.quantity ?? alloc.quantity,
            stockAfter: pi?.quantity ?? alloc.quantity,
            reservedBefore: (pi?.reservedQuantity ?? 0) + alloc.quantity,
            reservedAfter: pi?.reservedQuantity ?? 0,
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
            quantity: alloc.quantity,
            direction: 'IN',
            stockBefore: 0,
            stockAfter: alloc.quantity,
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
  ): Promise<void> {
    const reservation = await tx.comboComponentPhysicalReservation.findUnique({
      where: { componentId_cycleId: { componentId, cycleId } },
      include: { allocations: true },
    });

    if (!reservation) return;
    if (reservation.status === 'RELEASED' || reservation.status === 'RESTORED')
      return;

    if (reservation.status === 'ACTIVE') {
      for (const alloc of reservation.allocations) {
        await tx.physicalInventory.update({
          where: { id: alloc.physicalInventoryId },
          data: { reservedQuantity: { decrement: alloc.quantity } },
        });
      }
      await tx.comboComponentPhysicalReservation.update({
        where: { id: reservation.id },
        data: { status: 'RELEASED' },
      });
      return;
    }

    if (reservation.status === 'CONSUMED') {
      for (const alloc of reservation.allocations) {
        await tx.physicalInventory.update({
          where: { id: alloc.physicalInventoryId },
          data: { quantity: { increment: alloc.quantity } },
        });
        await tx.physicalInventoryLedger.create({
          data: {
            productId: reservation.productId,
            variantId: reservation.variantId ?? null,
            warehouseId: reservation.warehouseId,
            quantity: alloc.quantity,
            direction: 'IN',
            stockBefore: 0,
            stockAfter: alloc.quantity,
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
    if (product.availabilityMode !== 'MANAGED_STOCK' || !product.manageStock)
      return;

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
