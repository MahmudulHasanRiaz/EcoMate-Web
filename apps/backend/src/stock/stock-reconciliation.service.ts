import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStockDeductService } from './order-stock-deduct.service';
import { CancelReturnStockService } from './cancel-return-stock.service';
import { Prisma } from '@prisma/client';

/**
 * Result of a post-heal stock integrity verification. Compares the current
 * on-hand / reserved state of every product the heal touched against its
 * ledger trail and reports drift or negative available.
 */
export interface StockVerification {
  checked: number;
  managedDrifts: string[];
  physicalDrifts: string[];
  negativeAvailable: string[];
  incomingQty: number;
  deductedQty: number;
  reservedQty: number;
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
 *   2. Cancelled / Return Pending / Returned / Damaged orders with stock still
 *      reserved OR deducted → release / restore.
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
      this.logger.log(
        `Stock reconciliation on boot: DONE scanned=${result.scanned} ` +
        `deducted=${result.deliveredDeducted} restored=${result.cancelledRestored} ` +
        `blocked=${result.blocked.length}`,
      );
      this.logger.log(
        `Stock verification: checked=${v.checked} incoming=${v.incomingQty} ` +
        `deducted=${v.deductedQty} reserved=${v.reservedQty} ` +
        `drifts=${v.managedDrifts.length + v.physicalDrifts.length} ` +
        `negativeAvailable=${v.negativeAvailable.length}`,
      );
      for (const d of v.managedDrifts) this.logger.warn(`Stock verification drift (managed): ${d}`);
      for (const d of v.physicalDrifts) this.logger.warn(`Stock verification drift (physical): ${d}`);
      for (const d of v.negativeAvailable) this.logger.warn(`Stock verification negative available: ${d}`);
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
   * Returns a summary of what ran plus the verification result.
   */
  async healAll(): Promise<{
    scanned: number;
    deliveredDeducted: number;
    cancelledRestored: number;
    blocked: string[];
    verification: StockVerification;
  }> {
    const blocked: string[] = [];
    let deliveredDeducted = 0;
    let cancelledRestored = 0;
    const affectedKeys = new Set<string>();

    const orderIds = await this.findOrdersWithActiveStock();
    for (const { id, statusName } of orderIds) {
      try {
        const outcome = await this.healOrder(id, statusName);
        if (outcome === 'deducted') {
          deliveredDeducted++;
          for (const k of await this.orderAffectedKeys(id)) affectedKeys.add(k);
        } else if (outcome === 'restored') {
          cancelledRestored++;
          for (const k of await this.orderAffectedKeys(id)) affectedKeys.add(k);
        }
      } catch (err) {
        blocked.push(`${id}: ${(err as Error).message}`);
        this.logger.error(`Heal failed for order ${id}:`, err);
      }
    }

    const verification = await this.verifyStockIntegrity([...affectedKeys]);

    return {
      scanned: orderIds.length,
      deliveredDeducted,
      cancelledRestored,
      blocked,
      verification,
    };
  }

  /**
   * Heal a single order based on its current status.
   * Returns 'deducted' | 'restored' | 'noop'.
   */
  async healOrder(orderId: string, statusName?: string): Promise<'deducted' | 'restored' | 'noop'> {
    const status = statusName ?? (await this.getOrderStatusName(orderId));
    if (!status) return 'noop';

    // 1. Delivered / Partial → final deduction (managed + physical, combo-aware).
    if (status === 'Delivered' || status === 'Partial') {
      await this.prisma.$transaction(async (tx) => {
        await this.orderStockDeduct.deductForOrder({
          orderId,
          reference: `Heal Deduct: ${orderId}`,
          performedBy: 'reconcile',
          tx,
          strict: false,
        });
      });
      return 'deducted';
    }

    // 2. Cancelled / Return Pending / Returned / Damaged → release or restore.
    if (['Cancelled', 'Return Pending', 'Returned', 'Damaged'].includes(status)) {
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
    const statuses = ['Delivered', 'Partial', 'Cancelled', 'Return Pending', 'Returned', 'Damaged'];
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
   * Unique product/variant keys touched by an order (standalone items + combo
   * components). Used to scope post-heal verification to exactly the products
   * whose stock the heal may have changed.
   */
  private async orderAffectedKeys(orderId: string): Promise<string[]> {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
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
   * Post-heal stock integrity check for the products the heal touched.
   *
   * For each product/variant it compares the CURRENT managed on-hand/reserved
   * against the last ManagedStockLedger snapshot, and every physical row's
   * current quantity/reservedQuantity against its last PhysicalInventoryLedger
   * snapshot. Any drift, or a negative available (on-hand < reserved), is
   * reported as a mismatch.
   */
  async verifyStockIntegrity(keys: string[]): Promise<StockVerification> {
    const result: StockVerification = {
      checked: 0,
      managedDrifts: [],
      physicalDrifts: [],
      negativeAvailable: [],
      incomingQty: 0,
      deductedQty: 0,
      reservedQty: 0,
    };

    for (const key of keys) {
      const body = key.split(':')[1];
      if (!body) continue;
      const [productId, variantId] = body.split('|');
      if (!productId) continue;
      const vid = variantId || null;

      // Managed engine
      if (vid) {
        const v = await this.prisma.productVariant.findUnique({
          where: { id: vid },
          select: { managedStockQuantity: true, reservedStock: true },
        });
        if (v) {
          result.checked++;
          const last = await this.prisma.managedStockLedger.findFirst({
            where: { productId, variantId: vid },
            orderBy: { performedAt: 'desc' },
            select: { stockAfter: true, reservedAfter: true },
          });
          if (last && last.stockAfter != null) {
            if (last.stockAfter !== v.managedStockQuantity) {
              result.managedDrifts.push(
                `${key}: ledger on-hand ${last.stockAfter} ≠ actual ${v.managedStockQuantity}`,
              );
            }
            if (last.reservedAfter != null && last.reservedAfter !== v.reservedStock) {
              result.managedDrifts.push(
                `${key}: ledger reserved ${last.reservedAfter} ≠ actual ${v.reservedStock}`,
              );
            }
          }
          if (v.reservedStock > v.managedStockQuantity) {
            result.negativeAvailable.push(
              `${key}: reserved ${v.reservedStock} > on-hand ${v.managedStockQuantity}`,
            );
          }
        }
      } else {
        const p = await this.prisma.product.findUnique({
          where: { id: productId },
          select: { managedStockQuantity: true, reservedStock: true },
        });
        if (p) {
          result.checked++;
          const last = await this.prisma.managedStockLedger.findFirst({
            where: { productId, variantId: null },
            orderBy: { performedAt: 'desc' },
            select: { stockAfter: true, reservedAfter: true },
          });
          if (last && last.stockAfter != null) {
            if (last.stockAfter !== p.managedStockQuantity) {
              result.managedDrifts.push(
                `${key}: ledger on-hand ${last.stockAfter} ≠ actual ${p.managedStockQuantity}`,
              );
            }
            if (last.reservedAfter != null && last.reservedAfter !== p.reservedStock) {
              result.managedDrifts.push(
                `${key}: ledger reserved ${last.reservedAfter} ≠ actual ${p.reservedStock}`,
              );
            }
          }
          if (p.reservedStock > p.managedStockQuantity) {
            result.negativeAvailable.push(
              `${key}: reserved ${p.reservedStock} > on-hand ${p.managedStockQuantity}`,
            );
          }
        }
      }

      // Physical engine
      const pis = await this.prisma.physicalInventory.findMany({
        where: { productId, variantId: vid },
        select: {
          id: true,
          warehouseId: true,
          quantity: true,
          reservedQuantity: true,
        },
      });
      for (const pi of pis) {
        result.checked++;
        const last = await this.prisma.physicalInventoryLedger.findFirst({
          where: { productId, variantId: vid, warehouseId: pi.warehouseId },
          orderBy: { createdAt: 'desc' },
          select: { stockAfter: true, reservedAfter: true },
        });
        if (last) {
          if (last.stockAfter !== pi.quantity) {
            result.physicalDrifts.push(
              `${key}|wh:${pi.warehouseId}: ledger on-hand ${last.stockAfter} ≠ actual ${pi.quantity}`,
            );
          }
          if (last.reservedAfter != null && last.reservedAfter !== pi.reservedQuantity) {
            result.physicalDrifts.push(
              `${key}|wh:${pi.warehouseId}: ledger reserved ${last.reservedAfter} ≠ actual ${pi.reservedQuantity}`,
            );
          }
        }
        if (pi.reservedQuantity > pi.quantity) {
          result.negativeAvailable.push(
            `${key}|wh:${pi.warehouseId}: reserved ${pi.reservedQuantity} > on-hand ${pi.quantity}`,
          );
        }
      }
    }

    // Aggregate movement across the affected products' ledgers, scoped to the
    // movements that book stock. Labels track the user-facing meaning:
    //   incomingQty = IN movements total (adds / releases / restorations),
    //   deductedQty = final consumption (managed ORDER_DEDUCTION + physical DEDUCTION),
    //   reservedQty = reservation bookings (managed/storefront RESERVE + physical RESERVE).
    const productIds = [...new Set(keys.map((k) => k.split(':')[1]).filter(Boolean))];
    if (productIds.length > 0) {
      const [managedIn, physIn, managedDeduct, physDeduct, managedReserve, physReserve] =
        await Promise.all([
          this.prisma.managedStockLedger.aggregate({
            where: { productId: { in: productIds }, direction: 'IN' },
            _sum: { quantity: true },
          }),
          this.prisma.physicalInventoryLedger.aggregate({
            where: { productId: { in: productIds }, direction: 'IN' },
            _sum: { quantity: true },
          }),
          this.prisma.managedStockLedger.aggregate({
            where: { productId: { in: productIds }, type: 'ORDER_DEDUCTION' },
            _sum: { quantity: true },
          }),
          this.prisma.physicalInventoryLedger.aggregate({
            where: { productId: { in: productIds }, type: 'DEDUCTION' },
            _sum: { quantity: true },
          }),
          this.prisma.managedStockLedger.aggregate({
            where: { productId: { in: productIds }, type: 'RESERVE' },
            _sum: { quantity: true },
          }),
          this.prisma.physicalInventoryLedger.aggregate({
            where: { productId: { in: productIds }, type: 'RESERVE' },
            _sum: { quantity: true },
          }),
        ]);
      result.incomingQty = (managedIn._sum.quantity ?? 0) + (physIn._sum.quantity ?? 0);
      result.deductedQty = (managedDeduct._sum.quantity ?? 0) + (physDeduct._sum.quantity ?? 0);
      result.reservedQty = (managedReserve._sum.quantity ?? 0) + (physReserve._sum.quantity ?? 0);
    }

    return result;
  }
}