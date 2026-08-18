import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStockDeductService } from './order-stock-deduct.service';
import { CancelReturnStockService } from './cancel-return-stock.service';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';

export type InventoryVerifyScope = 'MANAGED' | 'WAREHOUSE' | 'BIN';

/**
 * Per-product lifetime verification row. "Expected" is derived from the last
 * authored ledger snapshot (the system's written history of on-hand / reserved
 * for that inventory unit); "actual" is the current inventory state, which is
 * the source of truth for reserved. PASS means ledger and current state agree.
 */
export interface ProductVerification {
  key: string;
  scope: InventoryVerifyScope;
  onHandExpected: number;
  onHandActual: number;
  reservedExpected: number;
  reservedActual: number;
  availableExpected: number;
  availableActual: number;
  pass: boolean;
  notes: string[];
}

export interface StockVerification {
  checked: number;
  pass: number;
  fail: number;
  products: ProductVerification[];
  negativeAvailable: string[];
}

/**
 * Per-inventory-unit change this heal execution produced (net movement counts,
 * captured from the 'reconcile' ledger rows written inside the run window).
 */
export interface HealPerProduct {
  key: string;
  released: number;
  deducted: number;
  restored: number;
}

export interface HealDelta {
  reservationsReleased: number;
  deductions: number;
  restorations: number;
  ordersRepaired: number;
  perProduct: HealPerProduct[];
}

/**
 * End-of-run reconciliation summary: how many inventory units were affected,
 * how many came into agreement, and what is still mismatched (and why).
 */
export interface ReconcileSummary {
  totalAffectedProducts: number;
  repairedProducts: number;
  remainingMismatches: number;
  unresolved: string[];
}

export interface HealAllResult {
  scanned: number;
  deliveredDeducted: number;
  cancelledRestored: number;
  releasedOrphaned: number;
  blocked: string[];
  delta: HealDelta;
  verification: StockVerification;
  summary: ReconcileSummary;
}

/**
 * StockReconciliationService
 *
 * Heals orders whose stock state drifted from their order status, caused by the
 * historical courier-webhook bug (reservation happened at order create, but the
 * final deduct/release/restore never ran because delivery bypassed the dispatch
 * HANDED_OVER path). Runs idempotently — safe to call repeatedly.
 *
 * Healed cases:
 *   1. Delivered / Partial orders with stock still RESERVED (not deducted) → deduct.
 *   2. Cancelled / Returned / Damaged orders with stock still
 *      reserved OR deducted → release / restore.
 *      ('Return Pending' is intentionally excluded: stock stays held until a
 *      return is manually confirmed as 'Returned'.)
 *
 * Idempotency is guaranteed by the underlying services:
 *   - OrderStockDeductService  → guarded by managedStockDeducted / reservation status.
 *   - CancelReturnStockService → guarded by managedStock flags + reservation status.
 */
@Injectable()
export class StockReconciliationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StockReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStockDeduct: OrderStockDeductService,
    private readonly cancelReturnStock: CancelReturnStockService,
    private readonly stockService: StockService,
    private readonly stockRouter: StockRouterService,
  ) {}

  /**
   * Boot-time auto-heal. Enabled only when STOCK_RECONCILE_ON_BOOT=true so it
   * is an explicit opt-in on redeploy (e.g. set via portainer environment) and
   * never runs by surprise on ordinary restarts.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env['STOCK_RECONCILE_ON_BOOT'] !== 'true') {
      return;
    }
    this.logger.log('Stock reconciliation on boot: START (STOCK_RECONCILE_ON_BOOT=true)');
    try {
      const result = await this.healAll();
      const v = result.verification;
      const d = result.delta;
      const s = result.summary;
      this.logger.log(
        `Stock reconciliation on boot: DONE scanned=${result.scanned} ` +
        `deducted=${result.deliveredDeducted} restored=${result.cancelledRestored} ` +
        `released=${result.releasedOrphaned} ` +
        `blocked=${result.blocked.length}`,
      );
      this.logger.log(
        `Heal delta: reservationsReleased=${d.reservationsReleased} ` +
        `deductions=${d.deductions} restorations=${d.restorations} ` +
        `ordersRepaired=${d.ordersRepaired}`,
      );
      this.logger.log(
        `Stock verification: checked=${v.checked} pass=${v.pass} fail=${v.fail} ` +
        `negativeAvailable=${v.negativeAvailable.length}`,
      );
      this.logger.log(
        `Reconcile summary: affected=${s.totalAffectedProducts} ` +
        `repaired=${s.repairedProducts} remaining=${s.remainingMismatches}`,
      );
      for (const u of v.products) {
        if (!u.pass) {
          this.logger.warn(
            `Stock verification FAIL [${u.scope}] ${u.key}: ` +
            `on-hand ${u.onHandActual} (snap ${u.onHandExpected}), ` +
            `reserved ${u.reservedActual} (snap ${u.reservedExpected}), ` +
            `available ${u.availableActual}${u.notes.length ? ` — ${u.notes.join('; ')}` : ''}`,
          );
        }
      }
      for (const r of s.unresolved) this.logger.warn(`Unresolved after heal: ${r}`);
      if (result.blocked.length > 0) {
        this.logger.warn(`Stock reconciliation blocked orders: ${result.blocked.join(' ; ')}`);
      }
    } catch (err) {
      this.logger.error('Stock reconciliation on boot failed:', err);
    }
  }

  /**
   * Heal the whole backlog of stale orders, then verify every product touched by
   * the heal still matches its ledger trail (on-hand, reserved, available).
   * Returns what ran (delta), the mode-aware verification, and an end-of-run
   * reconciliation summary.
   */
  async healAll(): Promise<HealAllResult> {
    const blocked: string[] = [];
    const healedOrderIds = new Set<string>();
    let deliveredDeducted = 0;
    let cancelledRestored = 0;
    let releasedOrphaned = 0;
    const healWindow = { start: new Date() };

    const orderIds = await this.findOrdersWithActiveStock();
    for (const { id, statusName } of orderIds) {
      try {
        const outcome = await this.healOrder(id, statusName);
        if (outcome === 'deducted') {
          deliveredDeducted++;
          healedOrderIds.add(id);
        } else if (outcome === 'restored') {
          cancelledRestored++;
          healedOrderIds.add(id);
        } else if (outcome === 'released') {
          releasedOrphaned++;
          healedOrderIds.add(id);
        }
      } catch (err) {
        blocked.push(`${id}: ${(err as Error).message}`);
        this.logger.error(`Heal failed for order ${id}:`, err);
      }
    }

    // Affected inventory units: one batched query across every healed order
    // (standalone items + combo components) — replaces the old per-order N+1.
    const affectedKeys = healedOrderIds.size > 0
      ? await this.batchAffectedKeys([...healedOrderIds])
      : [];

    const [delta, verification] = await Promise.all([
      this.captureHealDelta(healedOrderIds.size, healWindow.start),
      this.verifyStockIntegrity(affectedKeys),
    ]);

    const summary: ReconcileSummary = {
      totalAffectedProducts: verification.checked,
      repairedProducts: verification.pass,
      remainingMismatches: verification.fail,
      unresolved: [
        ...verification.negativeAvailable,
        ...verification.products.filter((u) => !u.pass).map((u) =>
          `${u.key}: ${u.notes.join('; ') || `on-hand ${u.onHandActual} ≠ snap ${u.onHandExpected}`}`,
        ),
      ],
    };

    return {
      scanned: orderIds.length,
      deliveredDeducted,
      cancelledRestored,
      releasedOrphaned,
      blocked,
      delta,
      verification,
      summary,
    };
  }

  /**
   * Heal a single order based on its current status.
   * Returns 'deducted' | 'restored' | 'released' | 'noop'.
   */
  async healOrder(orderId: string, statusName?: string): Promise<'deducted' | 'restored' | 'released' | 'noop'> {
    const status = statusName ?? (await this.getOrderStatusName(orderId));
    if (!status) return 'noop';

    // 1. Delivered / Partial → final deduction (managed + physical, combo-aware).
    if (status === 'Delivered' || status === 'Partial') {
      return await this.prisma.$transaction(async (tx) => {
        const orphans = await this.computeManagedOrphans(orderId, tx);
        const orphanIds = [...orphans.itemIds, ...orphans.componentIds];
        if (orphanIds.length > 0) {
          await this.releaseOrphanedReservations(tx, orphans, orderId);
        }
        await this.orderStockDeduct.deductForOrder({
          orderId,
          reference: `Heal Deduct: ${orderId}`,
          performedBy: 'reconcile',
          tx,
          strict: false,
          skipManagedUnitIds: new Set(orphanIds),
        });
        return orphanIds.length > 0 ? ('released' as const) : ('deducted' as const);
      });
    }

    // 2. Cancelled / Returned / Damaged → release or restore.
    // NOTE: 'Return Pending' intentionally NOT healed here — the business rule is
    // that stock must never be released/restored until the return is manually
    // confirmed ('Returned'). Reserved quantities stay held until then.
    if (['Cancelled', 'Returned', 'Damaged'].includes(status)) {
      await this.prisma.$transaction(async (tx) => {
        const prefix = status === 'Returned' || status === 'Damaged'
          ? 'return'
          : 'cancel';
        await this.cancelReturnStock.restoreForOrder({
          orderId,
          referencePrefix: prefix,
          performedBy: 'reconcile',
          tx,
        });
      });
      return 'restored';
    }

    return 'noop';
  }

  /**
   * Compute the set of managed-engine units (standalone items + combo
   * components) whose on-hand stock can no longer satisfy the order quantity —
   * the "orphaned reservation" case where the historical courier-webhook bug
   * reserved managed stock that the product no longer carries.
   *
   * Engine-aware: mirrors OrderStockDeductService.decision exactly
   * (StockRouterService.resolve per availability mode), so:
   *   - Physical-engine units (INVENTORY_CONTROLLED → ms:'skip') are NEVER
   *     orphans — their fulfillment path consumes the ACTIVE reservation and
   *     must keep running.
   *   - MANAGED_STOCK units with syncManagedStock are still orphans on the
   *     managed side when on-hand is short; the physical side is handled
   *     independently by the deduction (fulfill ACTIVE reservations).
   *   - Already-deducted units are never orphans (deduction is idempotent).
   *   - Non-managed products (manageStock=false) never throw on deduction.
   */
  private async computeManagedOrphans(
    orderId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ itemIds: string[]; componentIds: string[] }> {
    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
    const items = await tx.orderItem.findMany({
      where: { orderId },
      include: {
        product: {
          select: {
            id: true,
            type: true,
            manageStock: true,
            availabilityMode: true,
            syncManagedStock: true,
          },
        },
        comboComponents: {
          include: {
            product: {
              select: {
                id: true,
                type: true,
                manageStock: true,
                availabilityMode: true,
                syncManagedStock: true,
              },
            },
          },
        },
      },
    });

    const itemIds: string[] = [];
    const componentIds: string[] = [];

    for (const item of items) {
      if (!item.productId && !item.comboId) continue;

      if (item.comboId) {
        for (const snap of item.comboComponents) {
          const decision = this.stockRouter.resolve(
            snap.product?.availabilityMode,
            'deduct',
            imEnabled,
            snap.product?.syncManagedStock ?? undefined,
          );
          if (decision.ms !== 'deduct' || snap.managedStockDeducted) continue;
          if (!(await this.hasEnoughManaged(snap.productId, snap.variantId ?? undefined, snap.totalQuantity, tx))) {
            componentIds.push(snap.id);
          }
        }
        continue;
      }

      const decision = this.stockRouter.resolve(
        item.product?.availabilityMode,
        'deduct',
        imEnabled,
        item.product?.syncManagedStock ?? undefined,
      );
      if (decision.ms !== 'deduct' || item.managedStockDeducted) continue;
      if (!(await this.hasEnoughManaged(item.productId!, item.variantId ?? undefined, item.quantity, tx))) {
        itemIds.push(item.id);
      }
    }

    return { itemIds, componentIds };
  }

  /**
   * Managed on-hand sufficiency check that mirrors the guards inside
   * StockService.applyStockChange (the same guards that make a heal-time
   * deduction throw and leave the order permanently blocked):
   *   - variant → variant.managedStockQuantity, plus the parent product when
   *     it is a stock-managing simple product.
   *   - product → product.managedStockQuantity; non-managed products skip.
   */
  private async hasEnoughManaged(
    productId: string,
    variantId: string | undefined,
    quantity: number,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (variantId) {
      const v = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { managedStockQuantity: true, productId: true },
      });
      if (!v) return false;
      if ((v.managedStockQuantity ?? 0) < quantity) return false;
      const p = await tx.product.findUnique({
        where: { id: v.productId },
        select: { manageStock: true, type: true, managedStockQuantity: true },
      });
      if (p?.manageStock && p.type === 'simple' && (p.managedStockQuantity ?? 0) < quantity) {
        return false;
      }
      return true;
    }
    const p = await tx.product.findUnique({
      where: { id: productId },
      select: { manageStock: true, managedStockQuantity: true },
    });
    if (!p) return false;
    if (!p.manageStock) return true;
    return (p.managedStockQuantity ?? 0) >= quantity;
  }

  /**
   * Release orphaned managed reservations where stock was reserved but never
   * added. Used when on-hand can no longer satisfy the order quantity and
   * deduction is impossible. Only units that actually hold a reservation
   * (managedStockReserved) release the counter; units that were never
   * reserved are skipped from deduction via skipManagedUnitIds instead.
   */
  private async releaseOrphanedReservations(
    tx: Prisma.TransactionClient,
    orphans: { itemIds: string[]; componentIds: string[] },
    orderId: string,
  ): Promise<void> {
    const releaseManaged = async (params: {
      productId: string;
      variantId: string | null;
      quantity: number;
      reserved: boolean;
      update: () => Promise<unknown>;
    }) => {
      if (!params.reserved) return;
      await this.stockService.release({
        productId: params.productId,
        variantId: params.variantId ?? undefined,
        quantity: params.quantity,
        reference: `Heal Release Orphan: ${orderId}`,
        performedBy: 'reconcile',
        tx,
      });
      await params.update();
    };

    for (const id of orphans.itemIds) {
      const item = await tx.orderItem.findUnique({
        where: { id },
        select: { id: true, productId: true, variantId: true, quantity: true, managedStockReserved: true },
      });
      if (!item?.productId) continue;
      await releaseManaged({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        reserved: item.managedStockReserved,
        update: () =>
          tx.orderItem.update({ where: { id: item.id }, data: { managedStockReserved: false } }),
      });
    }

    for (const id of orphans.componentIds) {
      const comp = await tx.orderItemComboComponent.findUnique({
        where: { id },
        select: { id: true, productId: true, variantId: true, totalQuantity: true, managedStockReserved: true },
      });
      if (!comp?.productId) continue;
      await releaseManaged({
        productId: comp.productId,
        variantId: comp.variantId,
        quantity: comp.totalQuantity,
        reserved: comp.managedStockReserved,
        update: () =>
          tx.orderItemComboComponent.update({
            where: { id: comp.id },
            data: { managedStockReserved: false },
          }),
      });
    }
  }

  /**
   * Orders that carry active stock state inconsistent with a terminal status.
   *
   * Flags an order if ANY of these hold:
   *  - a managed reservation/deduction flag is still set on an item or combo, OR
   *  - a physical reservation still has status ACTIVE (standalone or combo).
   *
   * The physical check is essential: physical-only products (INVENTORY_CONTROLLED,
   * or MANAGED with syncManagedStock) never touch the managed flags, so a Delivered
   * order whose physical reservation was never fulfilled would otherwise be skipped
   * and its `reservedQuantity` would stay stuck.
   */
  private async findOrdersWithActiveStock(): Promise<
    { id: string; statusName: string }[]
  > {
    const statuses = ['Delivered', 'Partial', 'Cancelled', 'Returned', 'Damaged'];
    const [orders, activePhysical, activeCombo] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          trashedAt: null,
          status: { name: { in: statuses } },
        },
        select: {
          id: true,
          status: { select: { name: true } },
          items: {
            select: {
              managedStockReserved: true,
              managedStockDeducted: true,
              comboComponents: {
                select: {
                  managedStockReserved: true,
                  managedStockDeducted: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.physicalReservation.findMany({
        where: { status: 'ACTIVE' },
        select: { orderId: true },
      }),
      this.prisma.comboComponentPhysicalReservation.findMany({
        where: { status: 'ACTIVE' },
        select: { orderId: true },
      }),
    ]);

    const physicalDirty = new Set<string>();
    for (const r of activePhysical) physicalDirty.add(r.orderId);
    for (const r of activeCombo) physicalDirty.add(r.orderId);

    const active = orders.filter((o) => {
      // Any managed reservation/deduction flag still lingering counts as dirty.
      const flaggedManaged = o.items.some(
        (i) =>
          i.managedStockReserved ||
          i.managedStockDeducted ||
          i.comboComponents.some(
            (c) => c.managedStockReserved || c.managedStockDeducted,
          ),
      );
      if (flaggedManaged) return true;
      return physicalDirty.has(o.id);
    });

    return active.map((o) => ({
      id: o.id,
      statusName: o.status?.name || '',
    }));
  }

  private async getOrderStatusName(orderId: string): Promise<string | null> {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: { select: { name: true } } },
    });
    return o?.status?.name ?? null;
  }

  /**
   * Unique product/variant keys touched by a set of orders (standalone items +
   * combo components), in ONE batched query. Used to scope post-heal
   * verification to exactly the products whose stock the heal may have changed.
   */
  private async batchAffectedKeys(orderIds: string[]): Promise<string[]> {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        productId: true,
        variantId: true,
        comboComponents: {
          select: { productId: true, variantId: true },
        },
      },
    });

    const keys = new Set<string>();
    for (const i of items) {
      if (i.productId) keys.add(`p:${i.productId}|${i.variantId ?? ''}`);
      for (const c of i.comboComponents) {
        if (c.productId) keys.add(`p:${c.productId}|${c.variantId ?? ''}`);
      }
    }
    return [...keys];
  }

  /**
   * Last ledger snapshot per managed unit (key `p:<productId>|<variantId>`),
   * fetched for all products in one descending query; first row per unit wins
   * because performedAt is ordered globally descending.
   */
  private async lastManagedLedgerMap(productIds: string[]): Promise<
    Map<string, { stockAfter: number | null; reservedAfter: number | null }>
  > {
    const rows = await this.prisma.managedStockLedger.findMany({
      where: { productId: { in: productIds } },
      orderBy: [{ performedAt: 'desc' }, { id: 'desc' }],
      select: { productId: true, variantId: true, stockAfter: true, reservedAfter: true },
    });
    const map = new Map<string, { stockAfter: number | null; reservedAfter: number | null }>();
    for (const r of rows) {
      const key = `p:${r.productId}|${r.variantId ?? ''}`;
      if (!map.has(key)) map.set(key, { stockAfter: r.stockAfter, reservedAfter: r.reservedAfter });
    }
    return map;
  }

  /**
   * Last physical ledger snapshot per (product, variant, warehouse) unit,
   * fetched for all products in one descending query; first row per unit wins.
   */
  private async lastPhysicalLedgerMap(productIds: string[]): Promise<
    Map<string, { stockAfter: number | null; reservedAfter: number | null }>
  > {
    const rows = await this.prisma.physicalInventoryLedger.findMany({
      where: { productId: { in: productIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        productId: true,
        variantId: true,
        warehouseId: true,
        stockAfter: true,
        reservedAfter: true,
      },
    });
    const map = new Map<string, { stockAfter: number | null; reservedAfter: number | null }>();
    for (const r of rows) {
      const key = `${r.productId}|${r.variantId ?? ''}|${r.warehouseId}`;
      if (!map.has(key)) map.set(key, { stockAfter: r.stockAfter, reservedAfter: r.reservedAfter });
    }
    return map;
  }

  /**
   * Post-heal stock integrity check for the products the heal touched.
   *
   * Scope is mode-aware (never a hardcoded engine):
   *   • BIN       → product has physical rows carrying a binLocationId
   *   • WAREHOUSE → physical rows exist but none carry a bin (or bins disabled)
   *   • MANAGED   → no physical rows for the product/variant
   *
   * "Expected" comes from the last ledger snapshot for that inventory unit;
   * "actual" is the current inventory state (the source of truth for reserved).
   * A unit PASSes when ledger and current state agree; any negative available
   * is always a failure. All reads are batched — no per-unit queries.
   */
  async verifyStockIntegrity(keys: string[]): Promise<StockVerification> {
    const result: StockVerification = {
      checked: 0,
      pass: 0,
      fail: 0,
      products: [],
      negativeAvailable: [],
    };

    const validKeys = keys.filter((k) => k.startsWith('p:'));
    const productIds = [
      ...new Set(
        validKeys
          .map((k) => {
            const body = k.split(':')[1];
            return body ? body.split('|')[0] : null;
          })
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    if (productIds.length === 0) return result;

    // ---- Batch load current state (source of truth) -----------------------
    const [products, variants, physicalRows] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, managedStockQuantity: true, reservedStock: true },
      }),
      this.prisma.productVariant.findMany({
        where: { productId: { in: productIds } },
        select: { id: true, productId: true, managedStockQuantity: true, reservedStock: true },
      }),
      this.prisma.physicalInventory.findMany({
        where: { productId: { in: productIds } },
        select: {
          productId: true,
          variantId: true,
          warehouseId: true,
          binLocationId: true,
          quantity: true,
          reservedQuantity: true,
        },
      }),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const physByUnit = new Map<string, typeof physicalRows>();
    for (const r of physicalRows) {
      const key = `p:${r.productId}|${r.variantId ?? ''}`;
      const arr = physByUnit.get(key) ?? [];
      arr.push(r);
      physByUnit.set(key, arr);
    }

    // ---- Batch last ledger snapshots (expected) ---------------------------
    const lastManaged = await this.lastManagedLedgerMap(productIds);
    const lastPhysical = await this.lastPhysicalLedgerMap(productIds);

    const evaluate = (unit: ProductVerification, note: string, isNegative: boolean) => {
      result.checked++;
      unit.notes.push(note);
      const ok = !isNegative
        && unit.onHandExpected === unit.onHandActual
        && unit.reservedExpected === unit.reservedActual;
      unit.pass = ok;
      if (ok) result.pass++;
      else {
        result.fail++;
        if (isNegative) result.negativeAvailable.push(`${unit.key}: ${note}`);
      }
      result.products.push(unit);
    };

    // ---- Compare each managed unit -------------------------------------------
    for (const key of validKeys) {
      const body = key.split(':')[1];
      if (!body) continue;
      const [productId, variantId] = body.split('|');
      if (!productId) continue;
      const vid = variantId || null;
      const phys = physByUnit.get(key) ?? [];
      const binMode = phys.some((r) => r.binLocationId != null);
      const scope: InventoryVerifyScope = binMode
        ? 'BIN'
        : phys.length > 0
          ? 'WAREHOUSE'
          : 'MANAGED';

      const owner = vid ? variantMap.get(vid) : productMap.get(productId);
      if (!owner) continue;

      const onHandActual = Number(owner.managedStockQuantity ?? 0);
      const reservedActual = Number(owner.reservedStock ?? 0);

      const mSnap = lastManaged.get(key);
      const hasManagedData = mSnap || onHandActual > 0 || reservedActual > 0;

      // A WAREHOUSE/BIN unit whose stock lives in physical inventory should NOT
      // fall through to the managed engine when it has no managed data at all.
      // Only managed-scoped units (no physical rows) OR units with a managed
      // snapshot/state actually get a managed row.
      if (scope === 'MANAGED' || hasManagedData) {
        const onHandExpected = mSnap?.stockAfter != null ? Number(mSnap.stockAfter) : onHandActual;
        const reservedExpected =
          mSnap?.reservedAfter != null ? Number(mSnap.reservedAfter) : reservedActual;

        const unit: ProductVerification = {
          key,
          scope,
          onHandExpected,
          onHandActual,
          reservedExpected,
          reservedActual,
          availableExpected: onHandExpected - reservedExpected,
          availableActual: onHandActual - reservedActual,
          pass: false,
          notes: [],
        };

        const negative = unit.availableActual < 0;
        const note = negative
          ? `negative available (on-hand ${onHandActual} < reserved ${reservedActual})`
          : `on-hand ${onHandActual} / reserved ${reservedActual} vs snap ${onHandExpected} / ${reservedExpected}`;
        evaluate(unit, note, negative);
      }

      // ---- Physical rows: verify per-warehouse (aggregate of its bins) ------
      // The physical ledger is warehouse-scoped (no binLocationId column), so:
      //   • WAREHOUSE scope → the single warehouse-level row vs its ledger.
      //   • BIN scope → sum the warehouse's bin rows and compare the aggregate to
      //     the warehouse ledger (bin-level truth lives in PhysicalInventory rows
      //     themselves, never in the ledger). Each bin additionally gets a
      //     self-check row (current state) that still FAILs on negative available,
      //     without ever mixing one bin's state into another's.
      const physByWarehouse = new Map<string, typeof phys>();
      for (const pi of phys) {
        const arr = physByWarehouse.get(pi.warehouseId) ?? [];
        arr.push(pi);
        physByWarehouse.set(pi.warehouseId, arr);
      }

      for (const [warehouseId, whRows] of physByWarehouse) {
        const pSnap = lastPhysical.get(`${productId}|${vid ?? ''}|${warehouseId}`);
        const sumQty = whRows.reduce((a, r) => a + Number(r.quantity), 0);
        const sumRes = whRows.reduce((a, r) => a + Number(r.reservedQuantity ?? 0), 0);

        const whUnit: ProductVerification = {
          key: `${key}|wh:${warehouseId}`,
          scope,
          onHandExpected: pSnap?.stockAfter ?? sumQty,
          onHandActual: sumQty,
          reservedExpected: pSnap?.reservedAfter != null ? Number(pSnap.reservedAfter) : sumRes,
          reservedActual: sumRes,
          availableExpected: (pSnap?.stockAfter ?? sumQty) - (pSnap?.reservedAfter != null ? Number(pSnap.reservedAfter) : sumRes),
          availableActual: sumQty - sumRes,
          pass: false,
          notes: [],
        };
        const whNegative = whUnit.availableActual < 0;
        const whNote = whNegative
          ? `negative available (on-hand ${sumQty} < reserved ${sumRes})`
          : `on-hand ${sumQty} / reserved ${sumRes} vs snap ${pSnap?.stockAfter ?? sumQty} / ${pSnap?.reservedAfter ?? sumRes}`;
        evaluate(whUnit, whNote, whNegative);

        if (scope === 'BIN' && whRows.length > 1) {
          for (const pi of whRows) {
            const oH = Number(pi.quantity);
            const rS = Number(pi.reservedQuantity ?? 0);
            const binUnit: ProductVerification = {
              key: `${key}|wh:${warehouseId}|bin:${pi.binLocationId ?? 'null'}`,
              scope,
              onHandExpected: oH,
              onHandActual: oH,
              reservedExpected: rS,
              reservedActual: rS,
              availableExpected: oH - rS,
              availableActual: oH - rS,
              pass: false,
              notes: [],
            };
            const binNegative = binUnit.availableActual < 0;
            const binNote = binNegative
              ? `negative available (on-hand ${oH} < reserved ${rS})`
              : 'bin self-check (no bin-level ledger exists)';
            evaluate(binUnit, binNote, binNegative);
          }
        }
      }
    }

    return result;
  }

  /**
   * What THIS heal run changed, derived from the ledger rows it wrote
   * (performedBy 'reconcile') — never a ledger re-scan of the whole history.
   *
   * Category mapping (managed + physical):
   *   deductions  → OUT consumption (managed ORDER_DEDUCTION, physical DEDUCTION)
   *   released    → reservation freed without consumption (managed RELEASE, physical RELEASE)
   *   restorations→ consumed stock put back (managed CANCEL_RELEASE/RETURN, physical RESTORATION)
   *
   * `changed` must be >0 for the window to be meaningful (a heal that wrote no
   * ledger rows reports an empty, honest delta).
   */
  private async captureHealDelta(changed: number, windowStart: Date): Promise<HealDelta> {
    if (changed === 0) {
      return {
        reservationsReleased: 0,
        deductions: 0,
        restorations: 0,
        ordersRepaired: 0,
        perProduct: [],
      };
    }

    const [managed, physical] = await Promise.all([
      this.prisma.managedStockLedger.findMany({
        where: {
          performedById: 'reconcile',
          performedAt: { gte: windowStart },
        },
        orderBy: { performedAt: 'desc' },
        select: {
          productId: true,
          variantId: true,
          type: true,
          direction: true,
          quantity: true,
        },
      }),
      this.prisma.physicalInventoryLedger.findMany({
        where: {
          performedBy: 'reconcile',
          createdAt: { gte: windowStart },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          productId: true,
          variantId: true,
          warehouseId: true,
          type: true,
          direction: true,
          quantity: true,
        },
      }),
    ]);

    const perProduct = new Map<string, HealPerProduct>();
    let reservationsReleased = 0;
    let deductions = 0;
    let restorations = 0;

    type DeltaField = 'released' | 'deducted' | 'restored';
    const bump = (key: string, field: DeltaField, qty: number) => {
      const cur = perProduct.get(key) ?? { key, released: 0, deducted: 0, restored: 0 };
      cur[field] += qty;
      perProduct.set(key, cur);
    };

    for (const r of managed) {
      const key = `p:${r.productId}|${r.variantId ?? ''}`;
      if (r.type === 'ORDER_DEDUCTION') {
        deductions += r.quantity;
        bump(key, 'deducted', r.quantity);
      } else if (r.type === 'RELEASE') {
        reservationsReleased += r.quantity;
        bump(key, 'released', r.quantity);
      } else if (r.type === 'CANCEL_RELEASE' || r.type === 'RETURN') {
        restorations += r.quantity;
        bump(key, 'restored', r.quantity);
      }
    }
    for (const r of physical) {
      const key = `p:${r.productId}|${r.variantId ?? ''}|wh:${r.warehouseId}`;
      if (r.type === 'DEDUCTION') {
        deductions += r.quantity;
        bump(key, 'deducted', r.quantity);
      } else if (r.type === 'RELEASE') {
        reservationsReleased += r.quantity;
        bump(key, 'released', r.quantity);
      } else if (r.type === 'RESTORATION') {
        restorations += r.quantity;
        bump(key, 'restored', r.quantity);
      }
    }

    return {
      reservationsReleased,
      deductions,
      restorations,
      ordersRepaired: changed,
      perProduct: [...perProduct.values()],
    };
  }
}
