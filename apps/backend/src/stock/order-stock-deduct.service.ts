import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';
import { Prisma } from '@prisma/client';

/**
 * OrderStockDeductService
 *
 * Idempotent per-item, per-engine stock deduction on delivery.
 *
 * Why this exists:
 *  - Couriers auto-advance dispatches via webhook (`CourierWebhookService.upsertDispatch`)
 *    which writes `Dispatch.status` directly and NEVER calls `DispatchService.updateStatus`.
 *    As a result, the managed-stock / physical final deduction (previously only wired into
 *    the dispatch HANDED_OVER branch) was never executed for courier-delivered orders.
 *  - This service centralises the forward reserve→deduct finale so BOTH the dispatch
 *    HANDED_OVER/IN_TRANSIT path and the order-status Delivered path run identical logic.
 *
 * Idempotency (safe on any path / any retry):
 *  [Managed]      only deduct when `managedStockDeducted === false`, then set it true.
 *  [Physical]     only fulfill when reservation.status === 'ACTIVE'; CONSUMED is a no-op.
 *  [Costing Lots] only upgraded once via deduction guard inside StockService (skipCostingLotDeduct).
 *
 * Supported targets: standalone OrderItems and combo OrderItemComboComponent snapshots.
 */
@Injectable()
export class OrderStockDeductService {
  private readonly logger = new Logger(OrderStockDeductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly stockRouter: StockRouterService,
  ) {}

  /**
   * Deduct stock for an order's items at delivery.
   *
   * @param strict when true, a missing/invalid physical reservation throws (dispatch semantics).
   *               When false, gaps are tolerated and logged so courier auto-delivery can't
   *               silently fail to a hard 500 on legacy/edge orders.
   * @param skipManagedUnitIds managed-engine units (orderItem or combo-component ids) whose
   *               managed deduction must be skipped — the reconciliation heal releases those
   *               orphaned reservations before calling this, so a re-deduct must not throw.
   *               Physical fulfillment still runs for these units.
   */
  async deductForOrder(params: {
    orderId: string;
    reference: string;
    performedBy?: string;
    tx: Prisma.TransactionClient;
    strict?: boolean;
    skipManagedUnitIds?: Set<string>;
  }): Promise<void> {
    const { orderId, reference, performedBy, tx } = params;
    const strict = params.strict !== false;
    const skipManagedUnitIds = params.skipManagedUnitIds ?? new Set<string>();

    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
    const activeCycle = await tx.orderStockCycle.findFirst({
      where: { orderId, status: 'ACTIVE' },
    });

    const fullOrderItems = await tx.orderItem.findMany({
      where: { orderId },
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
    });

    for (const oi of fullOrderItems) {
      if (!oi.productId && !oi.comboId) continue;

      if (oi.comboId) {
        await this.deductComboItem(tx, oi, activeCycle?.id, imEnabled, reference, strict, performedBy, skipManagedUnitIds);
        continue;
      }

      await this.deductStandaloneItem(tx, oi, activeCycle?.id, imEnabled, reference, strict, performedBy, skipManagedUnitIds);
    }
  }

  private async deductComboItem(
    tx: Prisma.TransactionClient,
    oi: any,
    cycleId: string | null | undefined,
    imEnabled: boolean,
    reference: string,
    strict: boolean,
    performedBy?: string,
    skipManagedUnitIds: Set<string> = new Set(),
  ): Promise<void> {
    const snapshots = await tx.orderItemComboComponent.findMany({
      where: { orderItemId: oi.id },
      include: { product: true },
    });

    for (const snap of snapshots) {
      const compProduct = snap.product;
      const decision = this.stockRouter.resolve(
        compProduct.availabilityMode,
        'deduct',
        imEnabled,
        compProduct.syncManagedStock ?? undefined,
      );

      if (decision.ms === 'deduct' && !snap.managedStockDeducted && !skipManagedUnitIds.has(snap.id)) {
        await this.deductManaged(
          tx,
          snap.productId,
          snap.variantId ?? undefined,
          snap.totalQuantity,
          reference,
          performedBy,
          decision.pi === 'fulfill',
        );
        await tx.orderItemComboComponent.update({
          where: { id: snap.id },
          data: { managedStockDeducted: true },
        });
      }

      if (decision.pi === 'fulfill' && cycleId) {
        const compRes = await tx.comboComponentPhysicalReservation.findUnique({
          where: { componentId_cycleId: { componentId: snap.id, cycleId } },
          select: { id: true, status: true },
        });
        if (compRes?.status === 'CONSUMED') continue;
        if (compRes?.status === 'ACTIVE') {
          await this.stockService.fulfillPhysicalReservation({
            orderId: oi.orderId,
            cycleId,
            comboComponentId: snap.id,
            quantity: snap.totalQuantity,
            reference,
            performedBy: performedBy || 'system',
            tx,
          });
        } else if (!compRes) {
          if (strict) {
            const hasPhysicalInventory = await tx.physicalInventory.findFirst({
              where: { productId: snap.productId, variantId: snap.variantId || null },
              select: { id: true },
            });
            if (!hasPhysicalInventory) {
              throw new BadRequestException(
                `"${compProduct.name}" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই।`,
              );
            }
            throw new BadRequestException(
              `"${compProduct.name}" এর Combo Component Physical Reservation পাওয়া যায়নি — Delivery Deduction ঠিক করা যাবে না।`,
            );
          }
          this.logger.warn(
            `Strict-flag off: combo component ${snap.id} has no ACTIVE physical reservation; skipped physical fulfill.`,
          );
        } else {
          this.logger.warn(
            `Combo component ${snap.id} physical reservation has status "${compRes.status}"; skipped physical fulfill (matches prior behavior).`,
          );
        }
      }
    }
  }

  private async deductStandaloneItem(
    tx: Prisma.TransactionClient,
    oi: any,
    cycleId: string | null | undefined,
    imEnabled: boolean,
    reference: string,
    strict: boolean,
    performedBy?: string,
    skipManagedUnitIds: Set<string> = new Set(),
  ): Promise<void> {
    const product = oi.product;
    if (!product || !oi.productId) return;

    const decision = this.stockRouter.resolve(
      product.availabilityMode,
      'deduct',
      imEnabled,
      product.syncManagedStock ?? undefined,
    );

    if (decision.ms === 'deduct' && !oi.managedStockDeducted && !skipManagedUnitIds.has(oi.id)) {
      await this.deductManaged(
        tx,
        oi.productId,
        oi.variantId ?? undefined,
        oi.quantity,
        reference,
        performedBy,
        decision.pi === 'fulfill',
      );
      await tx.orderItem.update({
        where: { id: oi.id },
        data: { managedStockDeducted: true },
      });
    }

    if (decision.pi === 'fulfill' && cycleId) {
      const reservation = await tx.physicalReservation.findUnique({
        where: { orderItemId_cycleId: { orderItemId: oi.id, cycleId } },
        select: { id: true, status: true },
      });

      if (reservation?.status === 'CONSUMED') return;

      if (reservation?.status === 'ACTIVE') {
        await this.stockService.fulfillPhysicalReservation({
          orderId: oi.orderId,
          cycleId,
          orderItemId: oi.id,
          quantity: oi.quantity,
          reference,
          performedBy: performedBy || 'system',
          tx,
        });

        const consumptions = await tx.costingLotConsumption.findMany({
          where: {
            type: 'FULFILLMENT',
            referenceType: 'ORDER_ITEM',
            referenceId: oi.id,
            cycleId,
          },
        });
        if (consumptions.length > 0) {
          const totalCost = consumptions.reduce(
            (sum, c) => sum + Number(c.unitCost) * c.quantity,
            0,
          );
          const totalQty = consumptions.reduce((sum, c) => sum + c.quantity, 0);
          const actualCost = totalQty > 0 ? totalCost / totalQty : 0;
          await tx.orderItem.update({
            where: { id: oi.id },
            data: { costSnapshot: actualCost, costType: 'actual' },
          });
        }
      } else if (strict) {
        const hasPhysicalInventory = await tx.physicalInventory.findFirst({
          where: { productId: oi.productId, variantId: oi.variantId || null },
          select: { id: true },
        });
        if (!hasPhysicalInventory) {
          throw new BadRequestException(
            `"${product.name}" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই। ` +
            `Inventory Management চালু থাকলে Physical Stock ছাড়া Deduction করা যাবে না।`,
          );
        }
        throw new BadRequestException(
          `"${product.name}" এর Physical Reservation পাওয়া যায়নি — Delivery Deduction ঠিক করা যাবে না।`,
        );
      } else {
        this.logger.warn(
          `Strict-flag off: orderItem ${oi.id} has no ACTIVE physical reservation; skipped physical fulfill.`,
        );
      }
    }
  }

  private async deductManaged(
    tx: Prisma.TransactionClient,
    productId: string,
    variantId: string | undefined,
    quantity: number,
    reference: string,
    performedBy: string | undefined,
    skipCostingLotDeduct: boolean,
  ): Promise<void> {
    if (variantId) {
      await this.stockService.deduct({
        variantId,
        quantity,
        reference,
        performedBy: performedBy || 'system',
        tx,
        skipCostingLotDeduct,
      });
    } else {
      await this.stockService.deduct({
        productId,
        quantity,
        reference,
        performedBy: performedBy || 'system',
        tx,
        skipCostingLotDeduct,
      });
    }
  }
}