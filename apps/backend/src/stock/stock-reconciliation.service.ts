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
      this.logger.log(
        `Stock reconciliation on boot: DONE scanned=${result.scanned} ` +
        `deducted=${result.deliveredDeducted} restored=${result.cancelledRestored} ` +
        `blocked=${result.blocked.length}`,
      );
      if (result.blocked.length > 0) {
        this.logger.warn(`Stock reconciliation blocked orders: ${result.blocked.join(' ; ')}`);
      }
    } catch (err) {
      this.logger.error('Stock reconciliation on boot failed:', err);
    }
  }

  /**
   * Heal the whole backlog of stale orders. Returns a summary of what ran.
   */
  async healAll(): Promise<{
    scanned: number;
    deliveredDeducted: number;
    cancelledRestored: number;
    blocked: string[];
  }> {
    const blocked: string[] = [];
    let deliveredDeducted = 0;
    let cancelledRestored = 0;

    const orderIds = await this.findOrdersWithActiveStock();
    for (const { id, statusName } of orderIds) {
      try {
        const outcome = await this.healOrder(id, statusName);
        if (outcome === 'deducted') deliveredDeducted++;
        else if (outcome === 'restored') cancelledRestored++;
      } catch (err) {
        blocked.push(`${id}: ${(err as Error).message}`);
        this.logger.error(`Heal failed for order ${id}:`, err);
      }
    }

    return {
      scanned: orderIds.length,
      deliveredDeducted,
      cancelledRestored,
      blocked,
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
   */
  private async findOrdersWithActiveStock(): Promise<
    { id: string; statusName: string }[]
  > {
    const statuses = ['Delivered', 'Partial', 'Cancelled', 'Return Pending', 'Returned', 'Damaged'];
    const orders = await this.prisma.order.findMany({
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
    });

    const active = orders.filter((o) => {
      // Any managed reservation/deduction flag still lingering counts as dirty.
      const flagged = o.items.some(
        (i) =>
          i.managedStockReserved ||
          i.managedStockDeducted ||
          i.comboComponents.some(
            (c) => c.managedStockReserved || c.managedStockDeducted,
          ),
      );
      if (flagged) return true;
      return false;
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
}