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
        await this.restoreComboItem(tx, item, cycleId, imEnabled, reference, performedBy);
        continue;
      }

      // ── Standalone Item ───────────────────────────────────────────────────────
      await this.restoreStandaloneItem(tx, item, cycleId, imEnabled, reference, performedBy);
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

    const referencePrefix = reference.startsWith('cancel') ? 'cancel' : 'return';

    for (const snap of snapshots) {
      const compProduct = snap.product;

      // A. Managed Engine
      if (compProduct.availabilityMode === 'MANAGED_STOCK' && compProduct.manageStock) {
        if (snap.managedStockDeducted) {
          await this.stockService.operate('add', {
            productId: snap.productId,
            variantId: snap.variantId ?? undefined,
            quantity: snap.totalQuantity,
            reference,
            performedBy: performedBy || 'system',
            tx,
            ledgerType: referencePrefix === 'cancel' ? 'CANCEL_RELEASE' : 'RETURN',
          });
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

    const referencePrefix = reference.startsWith('cancel') ? 'cancel' : 'return';

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
    if (reservation.status === 'RELEASED' || reservation.status === 'RESTORED') return;

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
      // Restore: increment quantity only (NOT reservedQuantity per plan invariant), mark RESTORED
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
      await tx.physicalReservation.update({
        where: { id: reservation.id },
        data: { status: 'RESTORED' },
      });

      // Cycle-safe costing lot restore
      await this.restoreCostingLotsForCycle(tx, cycleId, referenceType, orderItemId, reference);
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
    if (reservation.status === 'RELEASED' || reservation.status === 'RESTORED') return;

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

      await this.restoreCostingLotsForCycle(tx, cycleId, referenceType, componentId, reference);
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
      const restoredQty = consumption.restorations.reduce((sum, r) => sum + r.quantity, 0);
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
    if (product.availabilityMode !== 'MANAGED_STOCK' || !product.manageStock) return;

    const referencePrefix = reference.startsWith('cancel') ? 'cancel' : 'return';

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
