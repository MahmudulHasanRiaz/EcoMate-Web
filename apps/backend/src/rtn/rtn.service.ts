import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { appendOrderTimeline } from '../orders/order-timeline.util';
import { OrdersEventService } from '../orders/orders-event.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { StockService } from '../stock/stock.service';
import { CacheService } from '../cache/cache.service';
import { Prisma } from '@prisma/client';
import { CreateReturnOrderDto } from './dto/create-return-order.dto';

export interface RtnActor {
  userId: string;
  email: string;
}

export interface RtnOrderPreview {
  id: string;
  displayId: string;
  status: string;
  itemCount: number;
}

export interface FinalizeReturnResult {
  outcome: 'returned' | 'already_returned';
  dispatch: {
    id: string;
    consignmentId: string;
    courier: string;
    status: string;
    oldStatus: string;
  };
  order: { id: string; displayId: string; status: string };
  rtn: RtnOrderPreview | null;
  restoredItems: { productId: string; variantId: string | null; quantity: number }[];
}

/**
 * RtnService — the Partial-return / RTN domain.
 *
 * Business invariants implemented here (see AGENTS.md audit spec):
 *  - 'Partial' means partial CUSTOMER ACCEPTANCE, never short shipment.
 *  - One original order → at most ONE RTN order (DB-unique returnOfOrderId).
 *  - RTN display id is derived from the original: ORD-xxx → RTN-xxx.
 *  - RTN creation moves original Partial → Delivered and RTN starts
 *    'Return Pending'. Stock is NOT touched at creation.
 *  - RTN 'Returned' restores EXACTLY the RTN item quantities (idempotent via
 *    Order.stockRestored). The original order stays 'Delivered'.
 *  - Full returns keep the existing direct workflow (original → Returned,
 *    restoreForOrder) — no RTN is created for them.
 */
@Injectable()
export class RtnService {
  private readonly logger = new Logger(RtnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly events: OrdersEventService,
    private readonly dispatchService: DispatchService,
    private readonly cancelReturnStock: CancelReturnStockService,
    private readonly stockService: StockService,
    private readonly cache: CacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async findForOriginalOrder(originalOrderId: string): Promise<RtnOrderPreview | null> {
    const rtn = await this.prisma.order.findFirst({
      where: { returnOfOrderId: originalOrderId },
      include: { status: true, _count: { select: { items: true } } },
    });
    if (!rtn) return null;
    return {
      id: rtn.id,
      displayId: rtn.displayId,
      status: rtn.status.name,
      itemCount: rtn._count.items,
    };
  }

  async findById(id: string) {
    const rtn = await this.prisma.order.findUnique({
      where: { id },
      include: {
        status: true,
        returnOfOrder: { include: { status: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, images: true } },
            variant: { select: { id: true, sku: true } },
            combo: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!rtn || rtn.trashedAt) throw new NotFoundException('Return order not found');
    return rtn;
  }

  // ---------------------------------------------------------------------------
  // RTN creation (Partial order → RTN + original adjustment)
  // ---------------------------------------------------------------------------

  /**
   * Create the RTN return order from a Partial original order.
   * ALL-OR-NOTHING: original quantity reduction + RTN creation + original
   * Partial → Delivered happen in ONE transaction. The unique constraint on
   * Order.returnOfOrderId is the last-line concurrency guard: two simultaneous
   * creations → exactly one wins, the other gets a deterministic 409.
   */
  async createFromPartialOrder(
    originalOrderId: string,
    dto: CreateReturnOrderDto,
    actor: RtnActor,
  ) {
    // ---- Request-level validation (before touching the database) ----------
    if (!dto.items?.length) {
      throw new BadRequestException('Select at least one item to return.');
    }
    const seen = new Set<string>();
    for (const item of dto.items) {
      if (seen.has(item.orderItemId)) {
        throw new BadRequestException(
          'Duplicate item lines are not allowed — combine quantities into one line.',
        );
      }
      seen.add(item.orderItemId);
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException('Return quantity must be a positive whole number.');
      }
    }

    const original = await this.prisma.order.findUnique({
      where: { id: originalOrderId },
      include: {
        status: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                availabilityMode: true,
                manageStock: true,
              },
            },
            variant: { select: { id: true } },
            combo: { select: { id: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!original || original.trashedAt) {
      throw new NotFoundException('Order not found');
    }
    if (original.kind === 'RETURN') {
      throw new BadRequestException('A Return Order cannot be created from another Return Order.');
    }

    // One original → one RTN. Checked BEFORE the status gate so an
    // already-resolved order gets the specific 409 (the DB unique constraint
    // on returnOfOrderId remains the concurrency guard).
    const existing = await this.findForOriginalOrder(originalOrderId);
    if (existing) {
      throw new ConflictException(
        `A Return Order already exists for this order (${existing.displayId}).`,
      );
    }

    if (original.status.name !== 'Partial') {
      throw new BadRequestException(
        `Only a Partial order can be resolved into a Return Order. Current status: ${original.status.name}.`,
      );
    }

    // Per-item validation against the ORIGINAL order lines.
    const lines = dto.items.map((line) => {
      const item = original.items.find((i) => i.id === line.orderItemId);
      if (!item) {
        throw new BadRequestException(
          'Every returned item must belong to the original order.',
        );
      }
      if (line.quantity > item.quantity) {
        throw new BadRequestException(
          `Return quantity cannot exceed the current order quantity for "${item.product?.name ?? 'item'}" (available: ${item.quantity}).`,
        );
      }
      return { line, item };
    });

    const rtnDisplayId = this.deriveRtnDisplayId(original.displayId);

    try {
      const rtn = await this.prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: a concurrent creator must not slip
        // through the pre-check above.
        const fresh = await tx.order.findUnique({
          where: { id: originalOrderId },
          include: { status: true },
        });
        if (!fresh || fresh.trashedAt) throw new NotFoundException('Order not found');
        if (fresh.status.name !== 'Partial') {
          throw new ConflictException(
            'This order is no longer Partial — it may already have been resolved.',
          );
        }
        const race = await tx.order.findFirst({
          where: { returnOfOrderId: originalOrderId },
          select: { id: true },
        });
        if (race) {
          throw new ConflictException('A Return Order already exists for this order.');
        }

        const [returnPending, delivered] = await Promise.all([
          tx.orderStatus.findUnique({ where: { name: 'Return Pending' } }),
          tx.orderStatus.findUnique({ where: { name: 'Delivered' } }),
        ]);
        if (!returnPending || !delivered) {
          throw new Error('Order status configuration is incomplete');
        }

        // ---- Create the RTN order (new id, RTN- display id, kind=RETURN) ----
        const rtnSubtotal = lines.reduce(
          (sum, { line, item }) => sum + Number(item.price) * line.quantity,
          0,
        );
        const now = new Date().toISOString();

        const created = await tx.order.create({
          data: {
            displayId: rtnDisplayId,
            kind: 'RETURN',
            returnOfOrderId: original.id,
            statusId: returnPending.id,
            source: 'MANUAL',
            subtotal: rtnSubtotal,
            shippingCharge: 0,
            discount: 0,
            discountType: 'flat',
            total: rtnSubtotal,
            // Customer snapshot copied from the original (who is returning).
            customerEmail: original.customerEmail,
            customerPhone: original.customerPhone,
            customerFirstName: original.customerFirstName,
            customerLastName: original.customerLastName,
            customerCity: original.customerCity,
            customerState: original.customerState,
            customerZip: original.customerZip,
            customerCountry: original.customerCountry,
            guestName: original.guestName,
            guestPhone: original.guestPhone,
            shippingAddress: original.shippingAddress as any,
            timeline: [
              {
                status: 'Return Pending',
                oldStatus: null,
                timestamp: now,
                note: `Return Order created from ${original.displayId} (partial return).`,
                performedBy: actor.email,
              },
            ] as any,
          },
        });

        // ---- RTN items (exact returned quantities) + combo snapshots --------
        for (const { line, item } of lines) {
          const rtnItem = await tx.orderItem.create({
            data: {
              orderId: created.id,
              productId: item.productId,
              variantId: item.variantId,
              comboId: item.comboId,
              comboSelection: item.comboSelection as any,
              quantity: line.quantity,
              price: item.price,
              sourceWarehouseId: item.sourceWarehouseId,
              sourceOrderItemId: item.id,
              managedStockReserved: false,
              managedStockDeducted: false,
            },
          });

          if (item.comboId) {
            const snapshots = await tx.orderItemComboComponent.findMany({
              where: { orderItemId: item.id },
              include: { product: true },
            });
            for (const snap of snapshots) {
              await tx.orderItemComboComponent.create({
                data: {
                  orderItemId: rtnItem.id,
                  comboItemId: snap.comboItemId,
                  productId: snap.productId,
                  variantId: snap.variantId,
                  unitQuantity: snap.unitQuantity,
                  totalQuantity: snap.unitQuantity * line.quantity,
                  managedStockReserved: false,
                  managedStockDeducted: false,
                },
              });
            }
          }
        }

        // ---- Reduce the original order lines (never leave quantity 0) ------
        // The line's stock holds must be released BEFORE the line disappears:
        // the release paths resolve holds per order item, so a deleted item
        // can never be visited again (orphaned reservation = availability
        // understated forever).
        const activeCycle = await tx.orderStockCycle.findFirst({
          where: { orderId: original.id, status: 'ACTIVE' },
          select: { id: true },
        });
        const remainingItems: { price: number; quantity: number }[] = [];
        for (const item of original.items) {
          const found = lines.find((l) => l.line.orderItemId === item.id);
          if (!found) {
            remainingItems.push({ price: Number(item.price), quantity: item.quantity });
            continue;
          }
          const { line } = found;
          const newQty = item.quantity - line.quantity;
          if (newQty <= 0) {
            // Full-line return: release the holds, then remove the line
            // (cascades combo snapshots).
            await this.releaseHoldsForRemovedLine(
              tx,
              original.id,
              activeCycle?.id ?? null,
              item,
              rtnDisplayId,
            );
            await tx.orderItem.delete({ where: { id: item.id } });
            continue;
          }
          await tx.orderItem.update({
            where: { id: item.id },
            data: { quantity: newQty },
          });
          remainingItems.push({ price: Number(item.price), quantity: newQty });
          if (item.comboId) {
            // Keep the frozen component snapshot consistent with the new qty.
            const snapshots = await tx.orderItemComboComponent.findMany({
              where: { orderItemId: item.id },
            });
            for (const snap of snapshots) {
              await tx.orderItemComboComponent.update({
                where: { id: snap.id },
                data: { totalQuantity: snap.unitQuantity * newQty },
              });
            }
          }
        }

        // ---- Original order: Partial → Delivered + timeline + totals ------
        // This is the ONLY legitimate Partial → Delivered path: the generic
        // status machine no longer exposes it (see migration
        // 20260930010000_rtn_return_orders). No stock side effects run here —
        // the accepted portion's stock was already handled by the original
        // order's own lifecycle (dispatch deduction).
        const totals = this.ordersService.recalculate(
          remainingItems,
          Number(original.shippingCharge),
          Number(original.discount),
          original.discountType || 'flat',
        );
        const originalTimelineEntry = {
          status: 'Delivered',
          oldStatus: 'Partial',
          timestamp: now,
          note: `Return Order ${rtnDisplayId} created — returned quantities removed from this order.`,
          performedBy: actor.email,
        };
        await tx.order.update({
          where: { id: original.id },
          data: {
            statusId: delivered.id,
            subtotal: totals.subtotal,
            total: totals.total,
          },
        });
        // Atomic append: a timeline read outside this transaction must never
        // overwrite entries written concurrently (notes, status changes).
        await appendOrderTimeline(tx, original.id, [originalTimelineEntry]);

        return created;
      });

      this.emitStatusChanged(rtn.id, rtn.displayId, 'Return Pending');
      this.emitStatusChanged(original.id, original.displayId, 'Delivered');
      this.invalidateAnalytics();

      return this.findById(rtn.id);
    } catch (err) {
      // Database-level one-original-one-RTN enforcement: the unique
      // constraint on returnOfOrderId rejects the second concurrent creator.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('A Return Order already exists for this order.');
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Dispatch return finalization (scanner + admin entry point)
  // ---------------------------------------------------------------------------

  /**
   * finalizeReturnFromDispatch — the controlled final Return action.
   *
   * One atomic operation:
   *   1. load + validate dispatch state
   *   2. resolve original order and (for Partial returns) the RTN
   *   3. atomically claim dispatch → RETURNED
   *   4. full return:    original Return Pending → Returned + restoreForOrder
   *      partial return:  RTN Return Pending → Returned + restore exact RTN qty
   *   5. timeline/audit on every mutated order
   *
   * Idempotent: a dispatch whose return is already fully settled returns
   * outcome 'already_returned' WITHOUT any mutation.
   */
  async finalizeDispatchReturn(
    dispatchId: string,
    actor: RtnActor,
  ): Promise<FinalizeReturnResult> {
    const dispatch = await this.prisma.dispatch.findUnique({
      where: { id: dispatchId },
    });
    if (!dispatch) throw new NotFoundException('Dispatch not found.');

    const order = await this.prisma.order.findUnique({
      where: { id: dispatch.orderId },
      include: { status: true },
    });
    if (!order || order.trashedAt) {
      throw new NotFoundException('Order not found');
    }
    if (order.kind === 'RETURN') {
      throw new BadRequestException('A Return Order dispatch cannot be finalized as a sale return.');
    }

    const rtn = await this.prisma.order.findFirst({
      where: { returnOfOrderId: order.id },
      include: { status: true },
    });

    // ---- Eligibility --------------------------------------------------------
    const eligibleDispatchStates = ['RETURN_PENDING', 'PARTIAL', 'RETURNED'];
    if (!eligibleDispatchStates.includes(dispatch.status)) {
      throw new BadRequestException(
        `This dispatch cannot be marked Returned from its current state (${dispatch.status}).`,
      );
    }

    // Partial order still unresolved → recoverable business exception that
    // guides the user to the RTN creation workflow. Nothing is mutated.
    if (order.status.name === 'Partial') {
      throw new BadRequestException(
        'This Partial order has not been resolved into a Return Order yet.',
      );
    }

    const rtnPending = rtn && rtn.status.name === 'Return Pending';
    const fullReturnPending = order.status.name === 'Return Pending';
    const partialResolved = order.status.name === 'Delivered' && rtnPending;
    // Heal path: the dispatch advanced into a return state without the order
    // following it (webhook / sync gap). ONLY a full-consignment return may
    // heal this way — a PARTIAL dispatch means part of the goods was actually
    // delivered, and restoring the FULL order quantity would add stock that
    // left the building. A partial return on a delivered order must be
    // resolved through the RTN workflow (or a manual Return Pending → Returned).
    const fullHeal =
      order.status.name === 'Delivered' &&
      !rtn &&
      (dispatch.status === 'RETURN_PENDING' || dispatch.status === 'RETURNED');

    if (!fullReturnPending && !partialResolved && !fullHeal) {
      // dispatch RETURNED but everything already settled → idempotent no-op.
      if (dispatch.status === 'RETURNED') {
        return {
          outcome: 'already_returned',
          dispatch: {
            id: dispatch.id,
            consignmentId: dispatch.consignmentId,
            courier: dispatch.courier,
            status: dispatch.status,
            oldStatus: dispatch.status,
          },
          order: { id: order.id, displayId: order.displayId, status: order.status.name },
          rtn: rtn
            ? { id: rtn.id, displayId: rtn.displayId, status: rtn.status.name, itemCount: 0 }
            : null,
          restoredItems: [],
        };
      }
      throw new BadRequestException(
        `This dispatch cannot be marked Returned from its current state (${dispatch.status}).`,
      );
    }

    // ---- Atomic execution ----------------------------------------------------
    const restoredItems: FinalizeReturnResult['restoredItems'] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: only one scanner/webhook race wins the transition.
      const claim = await tx.dispatch.updateMany({
        where: { id: dispatch.id, status: dispatch.status as any },
        data: { status: 'RETURNED', deliveredAt: null },
      });
      if (claim.count === 0) {
        // Lost the race — another actor finalized concurrently. Reload and
        // report the settled state without mutating anything.
        const current = await tx.dispatch.findUnique({ where: { id: dispatch.id } });
        const freshOrder = await tx.order.findUnique({
          where: { id: dispatch.orderId },
          include: { status: true },
        });
        return {
          raced: true,
          dispatchStatus: current?.status ?? 'RETURNED',
          orderStatus: freshOrder?.status.name ?? 'Unknown',
        };
      }

      const now = new Date().toISOString();

      if (partialResolved && rtn) {
        // ---- Partial return: RTN Return Pending → Returned + exact stock ----
        const returned = await tx.orderStatus.findUnique({ where: { name: 'Returned' } });
        if (!returned) throw new Error('Order status configuration is incomplete');

        const rtnFull = await tx.order.findUnique({
          where: { id: rtn.id },
          include: {
            status: true,
            items: { include: { product: true, combo: true } },
          },
        });
        if (!rtnFull || rtnFull.status.name !== 'Return Pending') {
          throw new BadRequestException('The Return Order is not in a returnable state.');
        }

        await this.cancelReturnStock.restoreForReturnOrder({
          rtnOrderId: rtn.id,
          performedBy: actor.email,
          tx,
        });

        const rtnTimelineEntry = {
          status: 'Returned',
          oldStatus: 'Return Pending',
          timestamp: now,
          note: `Return confirmed via dispatch ${dispatch.consignmentId}; returned quantities restored to stock.`,
          performedBy: actor.email,
        };
        const updatedRtn = await tx.order.update({
          where: { id: rtn.id },
          data: { statusId: returned.id, returnedAt: new Date(now) },
        });
        // Atomic append — never rewrite the RTN's timeline wholesale.
        await appendOrderTimeline(tx, rtn.id, [rtnTimelineEntry]);

        // Audit entry on the ORIGINAL order — it stays Delivered.
        const original = await tx.order.findUnique({ where: { id: order.id }, include: { status: true } });
        if (original) {
          await appendOrderTimeline(tx, order.id, [
            {
              status: original.status.name,
              oldStatus: original.status.name,
              timestamp: now,
              note: `Return Order ${rtn.displayId} marked Returned — returned quantities restored to stock.`,
              performedBy: actor.email,
            },
          ]);
        }

        for (const item of rtnFull.items) {
          restoredItems.push({
            productId: item.productId ?? '',
            variantId: item.variantId,
            quantity: item.quantity,
          });
        }

        return {
          raced: false,
          rtnDisplayId: updatedRtn.displayId,
          rtnStatus: 'Returned',
          orderStatus: 'Delivered',
          restoredItems,
        };
      }

      // ---- Full return: original → Returned + restoreForOrder ---------------
      const returned = await tx.orderStatus.findUnique({ where: { name: 'Returned' } });
      if (!returned) throw new Error('Order status configuration is incomplete');

      // Heal path: order never reached Return Pending (dispatch advanced
      // without the order). Step it through first so the audit trail shows
      // the real path.
      let fromStatus = order.status.name;
      if (order.status.name !== 'Return Pending') {
        const returnPending = await tx.orderStatus.findUnique({
          where: { name: 'Return Pending' },
        });
        if (!returnPending) throw new Error('Order status configuration is incomplete');
        await tx.order.update({
          where: { id: order.id },
          data: { statusId: returnPending.id },
        });
        await appendOrderTimeline(tx, order.id, [
          {
            status: 'Return Pending',
            oldStatus: order.status.name,
            timestamp: now,
            note: `Return initiated via dispatch ${dispatch.consignmentId}.`,
            performedBy: actor.email,
          },
        ]);
        fromStatus = 'Return Pending';
      }

      // Exact inverse of the forward flow — same primitive the manual
      // order-detail 'Returned' path uses.
      await this.cancelReturnStock.restoreForOrder({
        orderId: order.id,
        referencePrefix: 'return',
        performedBy: actor.email,
        tx,
      });

      const finalTimelineEntries = [
        {
          status: 'Return Pending',
          oldStatus: order.status.name,
          timestamp: now,
          note: `Return initiated via dispatch ${dispatch.consignmentId}.`,
          performedBy: actor.email,
        },
        {
          status: 'Returned',
          oldStatus: fromStatus,
          timestamp: now,
          note: `Return confirmed via dispatch ${dispatch.consignmentId}; stock restored.`,
          performedBy: actor.email,
        },
      ];
      await tx.order.update({
        where: { id: order.id },
        data: { statusId: returned.id },
      });
      await appendOrderTimeline(tx, order.id, finalTimelineEntries);

      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { productId: true, variantId: true, quantity: true },
      });
      for (const item of items) {
        restoredItems.push({
          productId: item.productId ?? '',
          variantId: item.variantId,
          quantity: item.quantity,
        });
      }

      return { raced: false, rtnDisplayId: null, rtnStatus: null, orderStatus: 'Returned', restoredItems };
    });

    // Lost the race — report the settled state idempotently.
    if ((result as any).raced) {
      return {
        outcome: 'already_returned',
        dispatch: {
          id: dispatch.id,
          consignmentId: dispatch.consignmentId,
          courier: dispatch.courier,
          status: (result as any).dispatchStatus,
          oldStatus: dispatch.status,
        },
        order: {
          id: order.id,
          displayId: order.displayId,
          status: (result as any).orderStatus,
        },
        rtn: rtn
          ? { id: rtn.id, displayId: rtn.displayId, status: rtn.status.name, itemCount: 0 }
          : null,
        restoredItems: [],
      };
    }
    void 0;

    const rtnPreview: RtnOrderPreview | null = (result as any).rtnDisplayId
      ? {
          id: rtn!.id,
          displayId: (result as any).rtnDisplayId,
          status: 'Returned',
          itemCount: 0,
        }
      : null;

    this.emitStatusChanged(order.id, order.displayId, (result as any).orderStatus);
    if (rtnPreview) this.emitStatusChanged(rtnPreview.id, rtnPreview.displayId, 'Returned');
    this.invalidateAnalytics();

    return {
      outcome: 'returned',
      dispatch: {
        id: dispatch.id,
        consignmentId: dispatch.consignmentId,
        courier: dispatch.courier,
        status: 'RETURNED',
        oldStatus: dispatch.status,
      },
      order: { id: order.id, displayId: order.displayId, status: (result as any).orderStatus },
      rtn: rtnPreview,
      restoredItems,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** ORD-260930-0001 → RTN-260930-0001 (new internal id, same business tail). */
  private deriveRtnDisplayId(originalDisplayId: string): string {
    return originalDisplayId.startsWith('ORD-')
      ? `RTN-${originalDisplayId.slice(4)}`
      : `RTN-${originalDisplayId}`;
  }

  /**
   * Release the stock holds a fully-returned line still owns.
   *
   * The release paths walk `order.items`, so a line that is removed here can
   * never be visited again — an ACTIVE physical reservation or a managed
   * reservation would keep holding availability for goods the order no longer
   * contains (permanently understated stock). Deducted lines are left alone:
   * their reservation is CONSUMED / managedStockDeducted and
   * `restoreForReturnOrder` restores exactly the returned quantity when the
   * Return Order is finalized. Idempotent (the release primitives no-op on a
   * CONSUMED/RELEASED reservation and on an already-zero counter).
   */
  private async releaseHoldsForRemovedLine(
    tx: Prisma.TransactionClient,
    orderId: string,
    cycleId: string | null,
    item: {
      id: string;
      productId: string | null;
      variantId: string | null;
      quantity: number;
      managedStockReserved: boolean;
      managedStockDeducted: boolean;
      comboId: string | null;
      product?: { availabilityMode: string; manageStock: boolean } | null;
    },
    rtnDisplayId: string,
  ): Promise<void> {
    const reference = `Return Order: ${rtnDisplayId}`;

    if (item.comboId) {
      const snapshots = await tx.orderItemComboComponent.findMany({
        where: { orderItemId: item.id },
        include: {
          product: { select: { availabilityMode: true, manageStock: true } },
        },
      });
      for (const snap of snapshots) {
        if (snap.managedStockReserved && !snap.managedStockDeducted) {
          await this.releaseManagedHold(
            tx,
            snap.product,
            snap.productId,
            snap.variantId,
            snap.totalQuantity,
            reference,
          );
        }
        if (cycleId) {
          await this.stockService.releasePhysicalAllocated({
            orderId,
            cycleId,
            comboComponentId: snap.id,
            tx,
          });
        }
      }
      return;
    }

    if (
      item.managedStockReserved &&
      !item.managedStockDeducted &&
      item.productId
    ) {
      await this.releaseManagedHold(
        tx,
        item.product,
        item.productId,
        item.variantId,
        item.quantity,
        reference,
      );
    }
    if (cycleId) {
      await this.stockService.releasePhysicalAllocated({
        orderId,
        cycleId,
        orderItemId: item.id,
        tx,
      });
    }
  }

  private async releaseManagedHold(
    tx: Prisma.TransactionClient,
    product: { availabilityMode: string; manageStock: boolean } | null | undefined,
    productId: string,
    variantId: string | null,
    quantity: number,
    reference: string,
  ): Promise<void> {
    if (!product) return;
    if (product.availabilityMode !== 'MANAGED_STOCK' || !product.manageStock) {
      return;
    }
    try {
      await this.stockService.operate('release', {
        productId,
        variantId: variantId ?? undefined,
        quantity,
        reference,
        performedBy: 'system',
        tx,
        ledgerType: 'RELEASE',
        referenceType: 'ORDER',
      });
    } catch (e) {
      // The counter may already be 0 (legacy/drifted rows) — a hold with
      // nothing left to release must never block the return workflow.
      this.logger.warn(
        `RTN removed-line hold release skipped (${productId}): ${(e as Error).message}`,
      );
    }
  }

  private emitStatusChanged(orderId: string, displayId: string, statusName: string) {
    try {
      this.events.emit({
        type: 'order.status_changed',
        data: { id: orderId, displayId, statusName },
      });
    } catch (e) {
      this.logger.error(`Failed to emit status_changed for ${orderId}:`, e);
    }
  }

  private invalidateAnalytics() {
    try {
      void this.cache?.invalidateByPrefix('analytics:');
    } catch {
      /* cache failure must never break the return workflow */
    }
  }
}
