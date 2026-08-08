import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';
import { CostingLotService } from './costing-lot.service';
import { Prisma } from '@prisma/client';

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
