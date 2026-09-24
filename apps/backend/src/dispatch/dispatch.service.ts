import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { OrderStockDeductService } from '../stock/order-stock-deduct.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { OrdersService } from '../orders/orders.service';
import { CourierTrackingService } from '../courier-manager/courier-tracking.service';
import {
  isSupportedCourier,
  mapCourierStatusToDispatchStatus,
} from '../courier-manager/courier-status-mapper';
import { Prisma } from '@prisma/client';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { DispatchQueryDto } from './dto/dispatch-query.dto';
import { impliesPickup } from './dispatch-timestamps';

// Actors that represent automated processes rather than a logged-in staff
// member. They must never move an order that is already 'Partial'.
const AUTOMATED_ACTOR_IDS = new Set([
  'system',
  'webhook',
  'courier_webhook',
  'reconcile',
]);

function isAutomatedActorId(actor?: string | null): boolean {
  return !actor || AUTOMATED_ACTOR_IDS.has(actor);
}

const DISPATCH_TRANSITIONS: Record<string, string[]> = {
  DISPATCHED: ['HANDED_OVER', 'HOLD', 'CANCELLED'],
  HANDED_OVER: ['PICKED_UP', 'HOLD', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'HOLD', 'CANCELLED'],
  IN_TRANSIT: ['ASSIGNED_TO_RIDER', 'HOLD', 'CANCELLED'],
  ASSIGNED_TO_RIDER: ['HOLD', 'DELIVERED', 'CANCELLED'],
  HOLD: [
    'PICKED_UP',
    'IN_TRANSIT',
    'ASSIGNED_TO_RIDER',
    'DELIVERED',
    'CANCELLED',
  ],
  DELIVERED: ['PARTIAL', 'RETURN_PENDING'],
  PARTIAL: ['RETURN_PENDING', 'CANCELLED'],
  RETURN_PENDING: ['RETURNED', 'CANCELLED'],
  RETURNED: ['CANCELLED'],
  CANCELLED: [],
};

// Order status names in progression order — used to only ever advance an
// order forward, mirroring the courier webhook pipeline.
const ORDER_STATUS_FLOW = [
  'Pending',
  'Payment Pending',
  'Payment Verifying',
  'Hold',
  'Confirmed',
  'Packed',
  'Packing Hold',
  'Shipping',
  'Delivered',
  'Partial',
  'Return Pending',
  'Returned',
  'Damaged',
  'Cancelled',
];

// Order transitions (same rules as the courier webhook service) — only used
// to find a forward path for orders that reject a direct advance.
const SYNC_ORDER_TRANSITIONS: Record<string, string[]> = {
  Pending: ['Payment Pending', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Pending': ['Payment Verifying', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Verifying': ['Confirmed', 'Hold', 'Cancelled'],
  Hold: ['Pending', 'Confirmed', 'Cancelled'],
  Confirmed: ['Packed', 'Packing Hold', 'Cancelled'],
  Packed: ['Shipping', 'Packing Hold'],
  'Packing Hold': ['Packed', 'Cancelled'],
  Shipping: ['Delivered', 'Partial'],
  Delivered: ['Return Pending'],
  Partial: ['Return Pending'],
  'Return Pending': ['Returned', 'Damaged'],
  Returned: ['Damaged'],
  Cancelled: ['Confirmed'],
  Damaged: [],
};

// Mapped DispatchStatus → order status (manual sync advances orders exactly
// like a (missed) courier webhook would).
const SYNC_DISPATCH_TO_ORDER: Record<string, string | null> = {
  DISPATCHED: null,
  PICKED_UP: 'Shipping',
  // Parcel physically with the courier — IN_TRANSIT must still guarantee the
  // order reached Shipping even when the pickup webhook was missed.
  IN_TRANSIT: 'Shipping',
  HOLD: 'Shipping',
  ASSIGNED_TO_RIDER: 'Shipping',
  DELIVERED: 'Delivered',
  PARTIAL: 'Partial',
  RETURN_PENDING: 'Return Pending',
  RETURNED: 'Return Pending',
  CANCELLED: null,
};

export interface DispatchSyncItemResult {
  id: string;
  dispatchId?: string;
  status?: string;
  message?: string;
  reason?: string;
}

export interface DispatchSyncSummary {
  total: number;
  synced: DispatchSyncItemResult[];
  unchanged: DispatchSyncItemResult[];
  failed: DispatchSyncItemResult[];
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStockDeduct: OrderStockDeductService,
    private readonly cancelReturnStock: CancelReturnStockService,
    private readonly tracking: CourierTrackingService,
    private readonly ordersService: OrdersService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  /**
   * Business analytics freshness (P2 §6): dispatches capture the fulfillment
   * cost and feed the Delivered-date fallback, so creation drops
   * `analytics:*`. No-op without cache; resilient.
   */
  private async invalidateAnalytics(): Promise<void> {
    try {
      await this.cache?.invalidateByPrefix('analytics:');
    } catch {
      /* cache failure must not fail dispatch creation */
    }
  }

  async findAll(query: DispatchQueryDto) {
    const where: Prisma.DispatchWhereInput = {};

    if (query.orderId) where.orderId = query.orderId;
    if (query.courier) where.courier = query.courier as any;
    if (query.status) where.status = query.status as any;
    if (query.search) {
      where.OR = [
        { consignmentId: { contains: query.search, mode: 'insensitive' } },
        { trackingCode: { contains: query.search, mode: 'insensitive' } },
        {
          order: { displayId: { contains: query.search, mode: 'insensitive' } },
        },
        {
          order: {
            guestPhone: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          order: {
            customer: {
              phone: { contains: query.search, mode: 'insensitive' },
            },
          },
        },
      ];
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const page = (query as any).page ? Number((query as any).page) : 1;
    const perPage = (query as any).perPage
      ? Number((query as any).perPage)
      : 10;

    const total = await this.prisma.dispatch.count({ where });
    const data = await this.prisma.dispatch.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            total: true,
            guestName: true,
            guestPhone: true,
            courierStatus: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    // Facet counts for the dispatch filter dropdowns — computed over the FULL
    // filtered list (search + date range), never the current page. Each facet
    // count excludes its own filter so switching a filter never collapses
    // sibling counts.
    const facetWhere: Prisma.DispatchWhereInput = { ...where };
    delete (facetWhere as any).status;
    delete (facetWhere as any).courier;

    const [statusGroups, courierGroups] = await Promise.all([
      this.prisma.dispatch.groupBy({
        by: ['status'],
        where: facetWhere,
        _count: { _all: true },
      }),
      this.prisma.dispatch.groupBy({
        by: ['courier'],
        where: facetWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      data,
      total,
      facets: {
        status: Object.fromEntries(
          statusGroups.map((g) => [g.status, g._count._all]),
        ),
        courier: Object.fromEntries(
          courierGroups.map((g) => [g.courier, g._count._all]),
        ),
      },
    };
  }

  async findOne(id: string) {
    const dispatch = await this.prisma.dispatch.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            total: true,
            guestName: true,
            guestPhone: true,
            courierStatus: true,
          },
        },
      },
    });
    if (!dispatch) throw new NotFoundException('Dispatch not found');
    return dispatch;
  }

  /**
   * Analytics cost capture, manual-write path (P2 §3.4). A staff-provided
   * dispatch cost fills a missing Order.shippingCost as 'manual' and
   * overrides a 'courier_default' estimate; an existing 'manual' cost always
   * wins and is never overwritten.
   *
   * Courier auto-fill (source 'courier_default' from a per-courier default)
   * is DEFERRED: no per-courier rate source exists anywhere in the system
   * (no settings model, no seed), so there is nothing truthful to auto-fill
   * from. When a rate source lands, it calls this same helper with an
   * explicit source — the manual-wins rule already holds.
   */
  private async maybeRecordShippingCost(
    orderId: string,
    dto: CreateDispatchDto,
  ): Promise<void> {
    if (dto.shippingCost === undefined || dto.shippingCost === null) return;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { shippingCost: true, shippingCostSource: true },
    });
    if (!order || order.shippingCost === null || order.shippingCost === undefined) {
      await this.prisma.order.updateMany({
        where: { id: orderId, shippingCost: null },
        data: { shippingCost: dto.shippingCost, shippingCostSource: 'manual' },
      });
      return;
    }
    if (order.shippingCostSource === 'courier_default') {
      await this.prisma.order.updateMany({
        where: { id: orderId },
        data: { shippingCost: dto.shippingCost, shippingCostSource: 'manual' },
      });
    }
    // Existing 'manual' (or any other recorded) cost wins — never overwrite.
  }

  async create(dto: CreateDispatchDto) {
    const existing = await this.prisma.dispatch.findUnique({
      where: {
        courier_consignmentId: {
          courier: dto.courier as any,
          consignmentId: dto.consignmentId,
        },
      },
    });

    if (existing && existing.status !== 'CANCELLED') {
      const flagged = await this.prisma.dispatch.create({
        data: {
          orderId: dto.orderId,
          courier: dto.courier as any,
          consignmentId: dto.consignmentId,
          trackingCode: dto.trackingCode,
          productMapping: (dto.productMapping ||
            []) as unknown as Prisma.InputJsonValue,
          notes: dto.notes,
          flaggedAt: new Date(),
        },
        include: {
          order: {
            select: {
              id: true,
              displayId: true,
              total: true,
              guestName: true,
              guestPhone: true,
              courierStatus: true,
            },
          },
        },
      });

      await this.prisma.courierDispatchLog.create({
        data: {
          orderId: dto.orderId,
          courier: dto.courier as any,
          status: 'DUPLICATION_FLAGGED',
          message: `Duplicate dispatch flagged. Existing: ${existing.id} (${existing.consignmentId}), New: ${flagged.id} (${dto.consignmentId}). Previous status: ${existing.status}`,
          consignmentId: dto.consignmentId,
          requestPayload: dto as any,
        },
      });

      // Link the order regardless of the duplicate flag: the created row must
      // be resolvable by webhooks and manual sync keyed on courier+consignment.
      await this.linkOrderToConsignment(dto);
      await this.maybeRecordShippingCost(dto.orderId, dto);
      await this.invalidateAnalytics();

      return {
        duplicate: true,
        id: flagged.id,
        message: 'Duplicate dispatch flagged for review',
        flagged: true,
      };
    }

    const created = await this.prisma.dispatch.create({
      data: {
        orderId: dto.orderId,
        courier: dto.courier as any,
        consignmentId: dto.consignmentId,
        trackingCode: dto.trackingCode,
        productMapping: (dto.productMapping ||
          []) as unknown as Prisma.InputJsonValue,
        notes: dto.notes,
      },
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            total: true,
            guestName: true,
            guestPhone: true,
          },
        },
      },
    });

    // Persist courierService/courierConsignmentId on the Order: without this,
    // webhooks AND the manual "Sync Status from Courier" lookups keyed on
    // coupon consignment miss manual dispatch-list rows entirely. The OR
    // guard keeps an order claimed by a DIFFERENT consignment untouched.
    await this.linkOrderToConsignment(dto);
    await this.maybeRecordShippingCost(dto.orderId, dto);
    await this.invalidateAnalytics();

    return created;
  }

  /**
   * Link the order to the dispatch's consignment so Pathao/Steadfast webhooks
   * and manual syncs can resolve it by consignment id. Never overwrites an
   * order already claimed by a different consignment/courier combo.
   */
  private async linkOrderToConsignment(dto: CreateDispatchDto): Promise<void> {
    await this.prisma.order.updateMany({
      where: {
        id: dto.orderId,
        OR: [
          { courierConsignmentId: null },
          { courierConsignmentId: dto.consignmentId },
        ],
      },
      data: {
        courierService: dto.courier as any,
        courierConsignmentId: dto.consignmentId,
        courierTrackingCode: dto.trackingCode || undefined,
      },
    });
  }

  async updateStatus(id: string, status: string, performedBy?: string) {
    // Validate transition BEFORE transaction
    const current = await this.prisma.dispatch.findUnique({
      where: { id },
      select: {
        status: true,
        orderId: true,
        courier: true,
        pickedUpAt: true,
        deliveredAt: true,
      },
    });
    if (!current) throw new NotFoundException('Dispatch not found');
    const allowed = DISPATCH_TRANSITIONS[current.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition from "${current.status}" to "${status}". Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    // Event timestamps. These columns are the authoritative event times for
    // KPI/reporting, so the transition that defines them MUST persist them.
    // Pickup/delivery are stamped once (first write wins) — re-entering a
    // status later must never move the original event time. Only a RETURNED
    // parcel retracts its delivery claim.
    const data: any = { status: status as any };
    switch (status) {
      case 'HANDED_OVER':
        data.handedOverAt = new Date();
        break;
      case 'DELIVERED':
        if (!current.deliveredAt) data.deliveredAt = new Date();
        break;
      case 'RETURNED':
        data.deliveredAt = null;
        break;
    }
    // Any status at-or-past physical possession counts as pickup for the
    // dashboard KPI — e.g. HOLD → IN_TRANSIT / DELIVERED never hits the
    // explicit PICKED_UP case above.
    if (impliesPickup(status) && !current.pickedUpAt) {
      data.pickedUpAt = new Date();
    }

    // ALL-OR-NOTHING: status claim + stock side effects in single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic conditional update: only one request wins
      const updateResult = await tx.dispatch.updateMany({
        where: { id, status: current.status as any },
        data,
      });

      if (updateResult.count === 0) {
        return { claimed: false, dispatch: await this.findOne(id) };
      }

      // Read the row INSIDE the transaction: a client outside it would not see
      // the update above and would hand a stale status to the order sync.
      const dispatch = await tx.dispatch.findUnique({ where: { id } });
      if (!dispatch) return { claimed: false, dispatch: null };

      if (
        status === 'HANDED_OVER' ||
        status === 'RETURNED' ||
        status === 'DAMAGED'
      ) {
        if (status === 'RETURNED' || status === 'DAMAGED') {
          return { claimed: true, dispatch };
        }

        // HANDED_OVER: deduct stock (managed + physical) via shared idempotent service.
        // Reads the ACTIVE OrderStockCycle to find the correct reservation to fulfill.
        // Combo children are processed via OrderItemComboComponent snapshots (independent stock targets).
        const reference = `Dispatch DEDUCT: ${dispatch.consignmentId}`;
        await this.orderStockDeduct.deductForOrder({
          orderId: dispatch.orderId,
          reference,
          performedBy,
          tx,
          strict: true,
        });
      }

      // IN_TRANSIT: recheck that deduction was applied (like Confirmed rechecks reservation).
      // If any managed stock deduction was missed, retry it now via the shared service.
      if (status === 'IN_TRANSIT') {
        const reference = `In Transit DEDUCT RECHECK: ${dispatch.consignmentId}`;
        await this.orderStockDeduct.deductForOrder({
          orderId: dispatch.orderId,
          reference,
          performedBy,
          tx,
          strict: false,
        });
      }

      return { claimed: true, dispatch };
    });

    if (result.claimed && result.dispatch) {
      // Sync the ORDER from the status this transition actually applied — not
      // from a re-read, and not one step behind (which silently dropped the
      // final Delivered advance).
      await this.syncOrderStatus(
        result.dispatch.orderId,
        status,
        result.dispatch.courier,
        performedBy,
      );
      // deliveredAt (Delivered-date fallback) and the synced order status are
      // recognition inputs — drop cached analytics like create() does.
      await this.invalidateAnalytics();
    }

    return result.dispatch;
  }

  private async syncOrderStatus(
    orderId: string,
    dispatchStatus: string,
    courier: string,
    performedBy?: string,
  ) {
    const map: Record<string, string> = {
      HANDED_OVER: 'Shipping',
      PICKED_UP: 'Shipping',
      IN_TRANSIT: 'Shipping',
      HOLD: 'Shipping',
      ASSIGNED_TO_RIDER: 'Shipping',
      DELIVERED: 'Delivered',
      PARTIAL: 'Partial',
      RETURN_PENDING: 'Return Pending',
      // IMPORTANT: dispatch "RETURNED" (courier dropped back the parcel) only
      // advances the order to 'Return Pending'. The final 'Returned' status —
      // which restores stock — must be set manually from the order detail.
      RETURNED: 'Return Pending',
      CANCELLED: 'Cancelled',
    };

    const targetName = map[dispatchStatus];
    if (!targetName) return;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order || order.trashedAt) return;

    const forder = [
      'Pending',
      'Payment Pending',
      'Payment Verifying',
      'Hold',
      'Confirmed',
      'Packed',
      'Packing Hold',
      'Shipping',
      'Delivered',
      'Partial',
      'Return Pending',
      'Returned',
      'Damaged',
      'Cancelled',
    ];
    const curIdx = forder.indexOf(order.status.name);
    const tgtIdx = forder.indexOf(targetName);
    if (curIdx < 0 || tgtIdx < 0 || curIdx >= tgtIdx) return;

    // AUTHORITATIVE RULE: 'Partial' is an automation-stopped state. Staff
    // dispatch changes (real user id) may move it; automated actors (system,
    // webhook simulators, reconcile) must not. The same rule is enforced for
    // the courier-sync path in OrdersService.updateStatus.
    if (order.status.name === 'Partial' && isAutomatedActorId(performedBy)) {
      return;
    }

    const targetStatus = await this.prisma.orderStatus.findUnique({
      where: { name: targetName },
    });
    if (!targetStatus) return;

    const timeline = [
      ...((order.timeline as unknown[]) || []),
      {
        status: targetName,
        oldStatus: order.status.name,
        timestamp: new Date().toISOString(),
        note: `Sync from dispatch (${dispatchStatus})`,
        performedBy: 'system',
      },
    ];

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        statusId: targetStatus.id,
        timeline: timeline as any,
      },
    });

    // Order-lifecycle custom tracking event for this genuine system transition
    // (forward-only guard above guarantees prev != new). Same idempotent
    // eventId contract as updateStatus(); isolated so capture can never break
    // the sync. This path bypasses OrdersService.updateStatus by design, so it
    // calls the public fire method directly with a server-resolved re-read.
    try {
      const withItems = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  category: { select: { name: true } },
                },
              },
              combo: { select: { id: true, name: true } },
              variant: { select: { id: true, sku: true } },
            },
          },
          customer: true,
        },
      });
      if (withItems) {
        await this.ordersService.fireOrderStatusLifecycleEvent(
          withItems as any,
          order.status.name,
          targetName,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to capture order lifecycle event for order ${orderId}:`,
        err,
      );
    }

    // Business rule: 'Return Pending' holds the reservation/deduction. The
    // deduction consumed the reservation counter at HANDED_OVER, so re-establish
    // the hold here (idempotent, RETURN_HOLD-ledged).
    if (targetName === 'Return Pending') {
      await this.cancelReturnStock.holdReservationForReturnPending(orderId);
    }
  }

  private async getOrderItemsForStock(
    orderId: string,
  ): Promise<{ productId?: string; variantId?: string; quantity: number }[]> {
    const orderItems = await this.prisma.orderItem.findMany({
      where: { orderId },
      select: {
        productId: true,
        variantId: true,
        comboId: true,
        comboSelection: true,
        quantity: true,
      },
    });

    const items: {
      productId?: string;
      variantId?: string;
      quantity: number;
    }[] = [];

    for (const oi of orderItems) {
      if (oi.comboId) {
        const combo = await this.prisma.combo.findUnique({
          where: { id: oi.comboId },
          include: { items: true },
        });
        if (combo) {
          for (const ci of combo.items) {
            const effectiveVariantId =
              ci.variantId ||
              (oi.comboSelection as any)?.[ci.productId] ||
              null;
            items.push({
              productId: ci.productId,
              variantId: effectiveVariantId || undefined,
              quantity: ci.quantity * oi.quantity,
            });
          }
        }
      } else {
        items.push({
          productId: oi.productId || undefined,
          variantId: oi.variantId || undefined,
          quantity: oi.quantity,
        });
      }
    }

    return items;
  }

  /**
   * Bulk "Sync Status from Courier": for every selected dispatch, ask the
   * courier's API for the latest/current courier status (force-refreshing the
   * tracking caches) and reconcile our Dispatch data with it — exactly like a
   * (possibly missed/delayed) webhook would:
   *
   *  - the raw courier status is persisted on `Dispatch.courierStatus`
   *    (never conflated with `Dispatch.status`, the internal workflow status);
   *    if the courier status maps to a DispatchStatus the dispatch status is
   *    updated too;
   *  - `Order.courierStatus` is kept in sync (webhook parity);
   *  - the order status is only ever advanced forward through the same
   *    order-status machinery the webhooks use;
   *  - every attempt is recorded in `CourierDispatchLog`.
   *
   * Dispatches are processed sequentially (rate-limit friendly) and a
   * consignment seen twice in one batch is fetched only once.
   */
  async syncStatusFromCourier(
    ids: string[],
    performedBy?: string,
  ): Promise<DispatchSyncSummary> {
    const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
    if (uniqueIds.length === 0) {
      throw new BadRequestException('No dispatch ids provided');
    }

    const dispatches = await this.prisma.dispatch.findMany({
      where: { id: { in: uniqueIds } },
      include: {
        order: {
          select: {
            id: true,
            customer: { select: { phone: true } },
            guestPhone: true,
          },
        },
      },
    });
    const byId = new Map(dispatches.map((d) => [d.id, d]));

    const summary: DispatchSyncSummary = {
      total: uniqueIds.length,
      synced: [],
      unchanged: [],
      failed: [],
    };

    const fetchedByConsignment = new Map<string, any | null>();
    const seenConsignments = new Set<string>();
    // Any branch below that writes (dispatch row, order row, timeline) flips
    // this — recognition inputs changed, so cached analytics must drop once
    // at the end. Failed-only runs write nothing and invalidate nothing.
    let mutated = false;

    for (const id of uniqueIds) {
      const dispatch = byId.get(id);
      if (!dispatch) {
        summary.failed.push({ id, reason: 'Dispatch not found' });
        continue;
      }
      const courier = dispatch.courier as string;
      if (!isSupportedCourier(courier)) {
        summary.failed.push({
          id,
          dispatchId: dispatch.id,
          reason: `Unsupported courier: ${courier}`,
        });
        continue;
      }
      if (!dispatch.consignmentId) {
        summary.failed.push({
          id,
          dispatchId: dispatch.id,
          reason: 'Missing consignment id',
        });
        continue;
      }

      try {
        const consignmentKey = `${courier}:${dispatch.consignmentId}`;
        let result: any;
        if (seenConsignments.has(consignmentKey)) {
          result = fetchedByConsignment.get(consignmentKey) ?? null;
        } else {
          const phone = this.normalizePhone(
            dispatch.order?.customer?.phone || dispatch.order?.guestPhone,
          );
          result = await this.tracking.getDispatchTracking(
            courier,
            phone,
            dispatch.consignmentId,
            dispatch.trackingCode,
            { force: true },
          );
          seenConsignments.add(consignmentKey);
          fetchedByConsignment.set(consignmentKey, result);
        }

        if (!result) {
          summary.failed.push({
            id,
            dispatchId: dispatch.id,
            reason: 'Courier API returned no tracking data',
          });
          continue;
        }
        if (result.configured === false) {
          summary.failed.push({
            id,
            dispatchId: dispatch.id,
            reason: 'Courier is not configured',
          });
          continue;
        }
        if (result.error) {
          summary.failed.push({
            id,
            dispatchId: dispatch.id,
            reason: result.error,
          });
          await this.logSync(dispatch, 'SYNC_FAILED', null, {
            performedBy,
            error: result.error,
          }).catch(() => undefined);
          continue;
        }

        const rawStatus = String(result.currentStatus || '').trim();
        if (!rawStatus) {
          summary.failed.push({
            id,
            dispatchId: dispatch.id,
            reason: 'No courier status available',
          });
          continue;
        }

        // Already up to date — refresh the sync timestamp, but STILL advance
        // the order to the status implied by the courier state: a (missed)
        // webhook may have recorded the raw courierStatus without moving the
        // workflow (e.g. Pathao `in-transit` recorded, order still Packed).
        // Sync is the healing path for that race.
        if (dispatch.courierStatus === rawStatus) {
          const unchangedMapped = mapCourierStatusToDispatchStatus(
            courier,
            rawStatus,
          );
          await this.prisma.dispatch.update({
            where: { id: dispatch.id },
            data: {
              lastSyncedAt: new Date(),
              // Heal a missed pickup stamp: courier already reports a
              // post-pickup state but pickedUpAt was never written.
              ...(impliesPickup(unchangedMapped) && !dispatch.pickedUpAt
                ? { pickedUpAt: new Date() }
                : {}),
            },
          });
          mutated = true;
          await this.applySyncOrderAdvancement(dispatch, rawStatus);
          await this.logSync(dispatch, 'SYNC_UNCHANGED', rawStatus, {
            performedBy,
            result,
          });
          summary.unchanged.push({
            id,
            dispatchId: dispatch.id,
            status: rawStatus,
            message: 'Already up to date',
          });
          continue;
        }

        const mappedStatus = mapCourierStatusToDispatchStatus(courier, rawStatus);
        let nextDispatchStatus: string | null = mappedStatus;
        if (mappedStatus === 'CANCELLED') {
          // Same business rule as the courier webhooks: a cancelled consignment
          // becomes RETURN_PENDING when the parcel had already progressed.
          nextDispatchStatus = await this.resolveCancelledWithProgress(
            dispatch.orderId,
          );
        }

        const statusAt = this.parseStatusAt(result);
        const effectiveStatus = nextDispatchStatus ?? mappedStatus;
        await this.prisma.dispatch.update({
          where: { id: dispatch.id },
          data: {
            courierStatus: rawStatus,
            courierStatusAt: statusAt ?? undefined,
            lastSyncedAt: new Date(),
            status: nextDispatchStatus
              ? (nextDispatchStatus as any)
              : undefined,
            ...(result.trackingUrl
              ? { trackingUrl: result.trackingUrl }
              : {}),
            // Stamp the pickup/delivery event time (authoritative for KPI and
            // reporting queries). First write wins: a later sync must not move
            // the original event timestamp. Any post-pickup status counts —
            // courier sync often maps straight to IN_TRANSIT/DELIVERED
            // without ever reporting PICKED_UP.
            ...(impliesPickup(effectiveStatus) && !dispatch.pickedUpAt
              ? { pickedUpAt: statusAt ?? new Date() }
              : {}),
            ...(effectiveStatus === 'DELIVERED' && !dispatch.deliveredAt
              ? { deliveredAt: statusAt ?? new Date() }
              : {}),
          },
        });

        // Order-level courier status (webhook parity: raw courier status).
        await this.prisma.order.update({
          where: { id: dispatch.orderId },
          data: {
            courierStatus: rawStatus,
            courierService: dispatch.courier,
          },
        });
        mutated = true;

        await this.addCourierSyncTimelineEntry(
          dispatch.orderId,
          courier,
          nextDispatchStatus || rawStatus,
          rawStatus,
        );

        if (nextDispatchStatus) {
          await this.applySyncOrderAdvancement(
            dispatch,
            rawStatus,
            nextDispatchStatus,
          );
        }

        await this.logSync(dispatch, 'SYNCED', rawStatus, {
          performedBy,
          result,
          nextDispatchStatus,
        });

        summary.synced.push({
          id,
          dispatchId: dispatch.id,
          status: rawStatus,
          message: nextDispatchStatus
            ? `Dispatch status updated to ${nextDispatchStatus}`
            : 'Courier status recorded',
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Sync failed';
        this.logger.warn(
          `Courier status sync failed for dispatch ${dispatch.id}: ${msg}`,
        );
        await this.logSync(dispatch, 'SYNC_FAILED', null, {
          performedBy,
          error: msg,
        }).catch(() => undefined);
        summary.failed.push({
          id,
          dispatchId: dispatch.id,
          reason: msg,
        });
      }
    }

    // Recognition inputs may have changed on any branch above (deliveredAt
    // stamps, order advancement, sync timeline entries) — drop cached
    // analytics once. Failed-only runs flipped nothing and skip this.
    if (mutated) await this.invalidateAnalytics();

    return summary;
  }

  private normalizePhone(raw?: string | null): string {
    const digits = (raw || '').replace(/\D/g, '');
    if (digits.length <= 11) {
      if (digits.length === 10) return `0${digits}`;
      return digits;
    }
    return digits.slice(-11);
  }

  private parseStatusAt(result: any): Date | null {
    const events = result?.events as any[] | undefined;
    const last = events && events.length ? events[events.length - 1] : null;
    const ts = last?.timestamp || '';
    if (ts && !Number.isNaN(Date.parse(ts))) return new Date(ts);
    const fetched = result?.fetchedAt;
    if (fetched && !Number.isNaN(Date.parse(fetched))) return new Date(fetched);
    return null;
  }

  private async resolveCancelledWithProgress(orderId: string): Promise<string> {
    const hasProgress = await this.prisma.dispatch.findFirst({
      where: {
        orderId,
        status: {
          in: [
            'HANDED_OVER',
            'PICKED_UP',
            'IN_TRANSIT',
            'ASSIGNED_TO_RIDER',
            'DELIVERED',
            'PARTIAL',
          ],
        },
      },
    });
    return hasProgress ? 'RETURN_PENDING' : 'CANCELLED';
  }

  private async addCourierSyncTimelineEntry(
    orderId: string,
    courier: string,
    status: string,
    rawStatus: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, trashedAt: null },
    });
    if (!order) return;
    const timeline = [
      ...((order.timeline as unknown[]) || []),
      {
        type: 'courier',
        courier,
        status,
        timestamp: new Date().toISOString(),
        note: `Courier sync: ${rawStatus}`,
      },
    ];
    await this.prisma.order.update({
      where: { id: orderId },
      data: { timeline: timeline as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Advance the ORDER to the status implied by the courier's mapped status.
   * Called from BOTH the fresh-sync branch and the already-up-to-date branch:
   * a (missed) webhook may have recorded the raw courierStatus without
   * advancing the workflow (e.g. Pathao `in-transit`, order still Packed), so
   * sync heals the order even when the courier status did not change.
   */
  private async applySyncOrderAdvancement(
    dispatch: any,
    rawStatus: string,
    preMapped?: string | null,
  ) {
    let mappedStatus: string | null =
      preMapped ??
      mapCourierStatusToDispatchStatus(
        dispatch.courier as string,
        rawStatus,
      );
    if (mappedStatus === 'CANCELLED') {
      // Same business rule as the courier webhooks: a cancelled consignment
      // becomes RETURN_PENDING when the parcel had already progressed.
      mappedStatus = await this.resolveCancelledWithProgress(
        dispatch.orderId,
      );
    }
    const targetName = mappedStatus
      ? SYNC_DISPATCH_TO_ORDER[mappedStatus]
      : undefined;
    if (targetName) {
      await this.advanceOrderStatusFromSync(dispatch.orderId, targetName);
    }
  }

  /**
   * Advance the order status exactly like the courier webhook pipeline: try a
   * direct transition through OrdersService (full side effects: COD payment
   * verification, stock/cancel handling, notification hooks); if the direct
   * step is rejected, walk forward through legal transitions.
   */
  private async advanceOrderStatusFromSync(orderId: string, targetName: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order || order.trashedAt) return;

    const currentIdx = ORDER_STATUS_FLOW.indexOf(order.status.name);
    const targetIdx = ORDER_STATUS_FLOW.indexOf(targetName);
    if (currentIdx < 0 || targetIdx < 0 || currentIdx >= targetIdx) return;

    const targetStatus = await this.prisma.orderStatus.findUnique({
      where: { name: targetName },
    });
    if (!targetStatus) return;

    try {
      await this.ordersService.updateStatus(
        orderId,
        { statusId: targetStatus.id },
        'system',
      );
      return;
    } catch (e) {
      this.logger.warn(
        `Direct transition to ${targetName} failed during courier sync: ${(e as Error).message}`,
      );
    }

    const path = this.findOrderTransitionPath(order.status.name, targetName);
    for (const step of path) {
      const current = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { status: true },
      });
      if (!current || current.status.name === targetName) break;
      const stepStatus = await this.prisma.orderStatus.findUnique({
        where: { name: step },
      });
      if (!stepStatus) continue;
      const allowed = SYNC_ORDER_TRANSITIONS[current.status.name] || [];
      if (!allowed.includes(step)) continue;
      try {
        await this.ordersService.updateStatus(
          orderId,
          { statusId: stepStatus.id },
          'system',
        );
      } catch (e2) {
        this.logger.warn(
          `Step ${current.status.name}→${step} failed during courier sync: ${(e2 as Error).message}`,
        );
        break;
      }
    }
  }

  private findOrderTransitionPath(from: string, to: string): string[] {
    const visited = new Set<string>();
    const queue: { status: string; path: string[] }[] = [
      { status: from, path: [] },
    ];
    visited.add(from);

    while (queue.length > 0) {
      const { status, path } = queue.shift()!;
      const allowed = SYNC_ORDER_TRANSITIONS[status] || [];
      for (const next of allowed) {
        if (next === to) return [...path, next];
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ status: next, path: [...path, next] });
        }
      }
    }
    return [];
  }

  private async logSync(
    dispatch: any,
    logStatus: string,
    rawStatus: string | null,
    extra: {
      performedBy?: string;
      result?: any;
      nextDispatchStatus?: string | null;
      error?: string;
    },
  ) {
    try {
      await this.prisma.courierDispatchLog.create({
        data: {
          orderId: dispatch.orderId,
          courier: dispatch.courier,
          status: logStatus,
          message: rawStatus
            ? `Courier status sync: ${rawStatus}${extra.nextDispatchStatus ? ` → dispatch ${extra.nextDispatchStatus}` : ''}`
            : extra.error || 'Courier status sync failed',
          consignmentId: dispatch.consignmentId,
          trackingCode: dispatch.trackingCode || undefined,
          requestPayload: extra.result
            ? {
                sync: 'manual',
                performedBy: extra.performedBy || 'unknown',
                dispatchId: dispatch.id,
                tracking: extra.result,
              }
            : {
                sync: 'manual',
                performedBy: extra.performedBy || 'unknown',
                dispatchId: dispatch.id,
                error: extra.error,
              },
        },
      });
    } catch (e: unknown) {
      this.logger.warn(
        `Failed to write CourierDispatchLog for dispatch ${dispatch.id}: ${(e as Error).message}`,
      );
    }
  }

  async findFlagged() {
    return this.prisma.dispatch.findMany({
      where: { flaggedAt: { not: null } },
      orderBy: { flaggedAt: 'desc' },
      include: {
        order: {
          select: {
            displayId: true,
            total: true,
            guestName: true,
            guestPhone: true,
          },
        },
      },
    });
  }

  async resolveFlagged(
    id: string,
    action: 'accept' | 'accessories' | 'cancel',
  ) {
    const dispatch = await this.findOne(id);
    if (!dispatch.flaggedAt)
      throw new BadRequestException('Dispatch is not flagged');

    if (action === 'cancel') {
      await this.prisma.dispatch.delete({ where: { id } });
      return { message: 'Duplicate dispatch cancelled' };
    }

    const updated = await this.prisma.dispatch.update({
      where: { id },
      data: {
        flaggedAt: null,
        notes: dispatch.notes
          ? `${dispatch.notes}\n[${action === 'accessories' ? 'Accessories' : 'Accepted'}]`
          : `[${action === 'accessories' ? 'Accessories' : 'Accepted'}]`,
      },
    });
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.prisma.dispatch.delete({ where: { id } });
    // Dispatch rows feed the Delivered-date fallback — dropping one changes
    // recognition inputs, so drop cached analytics too.
    await this.invalidateAnalytics();
    return deleted;
  }

  async getMetrics() {
    const [byCourier, byStatus, total] = await Promise.all([
      this.prisma.dispatch.groupBy({
        by: ['courier'],
        _count: true,
      }),
      this.prisma.dispatch.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.dispatch.count(),
    ]);

    return {
      total,
      byCourier: byCourier.map((g) => ({
        courier: g.courier,
        count: g._count,
      })),
      byStatus: byStatus.map((g) => ({ status: g.status, count: g._count })),
    };
  }
}
