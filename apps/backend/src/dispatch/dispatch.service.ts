import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {}

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

    return { data, total };
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

      return {
        duplicate: true,
        id: flagged.id,
        message: 'Duplicate dispatch flagged for review',
        flagged: true,
      };
    }

    return this.prisma.dispatch.create({
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
  }

  async updateStatus(id: string, status: string, performedBy?: string) {
    // Validate transition BEFORE transaction
    const current = await this.prisma.dispatch.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) throw new NotFoundException('Dispatch not found');
    const allowed = DISPATCH_TRANSITIONS[current.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition from "${current.status}" to "${status}". Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    const data: any = { status: status as any };
    switch (status) {
      case 'HANDED_OVER':
        data.handedOverAt = new Date();
        break;
      case 'PICKED_UP':
        data.pickedUpAt = new Date();
        break;
      case 'DELIVERED':
        data.deliveredAt = new Date();
        break;
      case 'RETURNED':
        data.deliveredAt = null;
        break;
    }

    // ALL-OR-NOTHING: status claim + stock side effects in single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic conditional update: only one request wins
      const updateResult = await tx.dispatch.updateMany({
        where: { id, status: current.status as any },
        data: {
          status: status as any,
          handedOverAt: data.handedOverAt || null,
        },
      });

      if (updateResult.count === 0) {
        return { claimed: false, dispatch: await this.findOne(id) };
      }

      // Stock operations — only if we won the claim
      const dispatch = await this.findOne(id);
      const productMapping = dispatch.productMapping as any[] | null;

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

    if (result.claimed) {
      await this.syncOrderStatus(
        result.dispatch.orderId,
        result.dispatch.status,
        result.dispatch.courier,
        performedBy,
      );
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

    // Business rule: 'Return Pending' holds the reservation/deduction. The
    // deduction consumed the reservation counter at HANDED_OVER, so re-establish
    // the hold here (idempotent, ledged as RETURN_HOLD).
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

        // Already up to date — just refresh the sync timestamp.
        if (dispatch.courierStatus === rawStatus) {
          await this.prisma.dispatch.update({
            where: { id: dispatch.id },
            data: { lastSyncedAt: new Date() },
          });
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

        await this.addCourierSyncTimelineEntry(
          dispatch.orderId,
          courier,
          nextDispatchStatus || rawStatus,
          rawStatus,
        );

        if (nextDispatchStatus) {
          const targetName = SYNC_DISPATCH_TO_ORDER[nextDispatchStatus];
          if (targetName) {
            await this.advanceOrderStatusFromSync(dispatch.orderId, targetName);
          }
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
    return this.prisma.dispatch.delete({ where: { id } });
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
