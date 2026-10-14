import { Injectable, Logger, Inject, forwardRef, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { CourierManagerService } from './courier-manager.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { mapSteadfastReturnStatus } from './courier-status-mapper';
import { impliesPickup } from '../dispatch/dispatch-timestamps';

const ORDER_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['Payment Pending', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Pending': ['Payment Verifying', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Verifying': ['Confirmed', 'Hold', 'Cancelled'],
  'Hold': ['Pending', 'Confirmed', 'Cancelled'],
  'Confirmed': ['Packed', 'Packing Hold', 'Cancelled'],
  'Packed': ['Shipping', 'Packing Hold'],
  'Packing Hold': ['Packed', 'Cancelled'],
  'Shipping': ['Delivered', 'Partial'],
  'Delivered': ['Return Pending'],
  'Partial': ['Return Pending'],
  'Return Pending': ['Returned', 'Damaged'],
  'Returned': ['Damaged'],
  'Cancelled': ['Confirmed'],
  'Damaged': [],
};

const ORDER_STATUS_FLOW = [
  'Pending', 'Payment Pending', 'Payment Verifying', 'Hold', 'Confirmed',
  'Packed', 'Packing Hold', 'Shipping', 'Delivered', 'Partial',
  'Return Pending', 'Returned', 'Damaged', 'Cancelled',
];

// Steadfast status → DispatchStatus (direct mapping)
const STEADFAST_DISPATCH_MAP: Record<string, string | null> = {
  in_review: 'DISPATCHED',
  pending: 'PICKED_UP',
  hold: 'HOLD',
  // Approval-pending states: the parcel has not progressed to its final
  // status until the courier confirms — keep at rider/shipping stage.
  delivered_approval_pending: 'ASSIGNED_TO_RIDER',
  // AUTHORITATIVE RULE: partial delivery (incl. approval-pending) → 'Partial'.
  partial_delivered_approval_pending: 'PARTIAL',
  cancelled_approval_pending: 'ASSIGNED_TO_RIDER',
  unknown_approval_pending: null, // needs support contact — never force a status
  delivered: 'DELIVERED',
  partial_delivered: 'PARTIAL',
  cancelled: null, // handled conditionally in handleSteadfast
  unknown: 'CANCELLED',
};

// DispatchStatus → OrderStatus name mapping (when webhook should auto-update order)
// AUTHORITATIVE RULE: PARTIAL from ANY courier advances the order to 'Partial'
// (no provider exception). 'Partial' is then an automation-stopped state — the
// lock is enforced in OrdersService.updateStatus for automated actors.
const DISPATCH_TO_ORDER_STATUS: Record<string, string | null> = {
  HANDED_OVER: 'Shipping',
  PICKED_UP: 'Shipping',
  IN_TRANSIT: 'Shipping',
  HOLD: 'Shipping',
  ASSIGNED_TO_RIDER: 'Shipping',
  DELIVERED: 'Delivered',
  PARTIAL: 'Partial',
  RETURN_PENDING: 'Return Pending',
  CANCELLED: null,
};

// Pathao event → DispatchStatus
const PATHAO_DISPATCH_MAP: Record<string, string | null> = {
  'order.created': 'DISPATCHED',
  'order.updated': null,
  'order.pickup-requested': null,
  'order.assigned-for-pickup': null,
  'order.picked': 'PICKED_UP',
  'order.pickup-failed': null,
  'order.pickup-cancelled': 'CANCELLED',
  'order.at-the-sorting-hub': 'IN_TRANSIT',
  'order.in-transit': 'IN_TRANSIT',
  'order.received-at-last-mile-hub': 'ASSIGNED_TO_RIDER',
  'order.assigned-for-delivery': 'ASSIGNED_TO_RIDER',
  'order.delivered': 'DELIVERED',
  'order.partial-delivery': 'PARTIAL',
  'order.returned': 'RETURN_PENDING',
  'order.delivery-failed': null,
  'order.on-hold': 'HOLD',
  'order.paid': 'DELIVERED',
  'order.paid-return': 'RETURN_PENDING',
  'order.exchanged': 'DELIVERED',
  'order.return-id-created': 'RETURN_PENDING',
  'order.return-in-transit': 'RETURN_PENDING',
  'order.returned-to-merchant': 'RETURNED',
};

// Pathao DispatchStatus → OrderStatus
const PATHAO_DISPATCH_TO_ORDER: Record<string, string | null> = {
  HANDED_OVER: 'Shipping',
  PICKED_UP: 'Shipping',
  // Parcel physically with the courier — if the `picked` webhook was missed,
  // IN_TRANSIT still guarantees the order leaves Packed and reaches Shipping.
  IN_TRANSIT: 'Shipping',
  HOLD: 'Shipping',
  ASSIGNED_TO_RIDER: 'Shipping',
  DELIVERED: 'Delivered',
  PARTIAL: 'Partial',
  RETURN_PENDING: 'Return Pending',
  RETURNED: 'Return Pending',
  CANCELLED: null,
};

// Carrybee event → DispatchStatus
const CARRYBEE_DISPATCH_MAP: Record<string, string | null> = {
  'order.created': 'DISPATCHED',
  'order.create-failed': 'CANCELLED',
  'order.updated': null,
  'order.pickup-requested': null,
  'order.assigned-for-pickup': null,
  'order.picked': 'PICKED_UP',
  'order.pickup-failed': null,
  'order.pickup-cancelled': 'CANCELLED',
  'order.at-the-sorting-hub': 'IN_TRANSIT',
  'order.on-the-way-to-central-warehouse': 'IN_TRANSIT',
  'order.at-central-warehouse': 'IN_TRANSIT',
  'order.in-transit': 'IN_TRANSIT',
  'order.received-at-last-mile-hub': 'ASSIGNED_TO_RIDER',
  'order.assigned-for-delivery': 'ASSIGNED_TO_RIDER',
  'order.delivery-on-hold': 'HOLD',
  'order.delivered': 'DELIVERED',
  'order.partial-delivery': 'PARTIAL',
  'order.delivery-failed': null,
  'order.returned': 'RETURN_PENDING',
  'order.paid-return': 'RETURN_PENDING',
  'order.exchange': 'DELIVERED',
  'order.paid': 'DELIVERED',
  'order.returned-at-sorting': 'RETURN_PENDING',
  'order.returned-in-transit': 'RETURN_PENDING',
  'order.returned-to-merchant': 'RETURNED',
};

// Carrybee DispatchStatus → OrderStatus
const CARRYBEE_DISPATCH_TO_ORDER: Record<string, string | null> = {
  HANDED_OVER: 'Shipping',
  PICKED_UP: 'Shipping',
  IN_TRANSIT: 'Shipping',
  HOLD: 'Shipping',
  ASSIGNED_TO_RIDER: 'Shipping',
  DELIVERED: 'Delivered',
  PARTIAL: 'Partial',
  RETURN_PENDING: 'Return Pending',
  RETURNED: 'Return Pending',
  CANCELLED: null,
};

// RedX webhook status → DispatchStatus
const REDX_DISPATCH_MAP: Record<string, string | null> = {
  // Task 5 (owner-locked): booked awaiting pickup = DISPATCHED (verified:
  // Dispatch defaults to DISPATCHED; order.created → DISPATCHED). The
  // DISPATCHED → order map below is null, so the order is never moved.
  'pickup-pending': 'DISPATCHED',
  pickup_pending: 'DISPATCHED',
  'ready-for-delivery': 'PICKED_UP',
  'delivery-in-progress': 'ASSIGNED_TO_RIDER',
  delivered: 'DELIVERED',
  // AUTHORITATIVE RULE: PARTIAL → 'Partial' for every courier, no exception.
  partial: 'PARTIAL',
  partial_delivered: 'PARTIAL',
  'agent-hold': 'HOLD',
  'agent-returning': 'RETURN_PENDING',
  returned: 'RETURN_PENDING',
  'agent-area-change': null,
};

// RedX DispatchStatus → OrderStatus
const REDX_DISPATCH_TO_ORDER: Record<string, string | null> = {
  DISPATCHED: null,
  HANDED_OVER: 'Shipping',
  PICKED_UP: 'Shipping',
  IN_TRANSIT: 'Shipping',
  HOLD: 'Shipping',
  ASSIGNED_TO_RIDER: 'Shipping',
  DELIVERED: 'Delivered',
  PARTIAL: 'Partial',
  RETURN_PENDING: 'Return Pending',
  RETURNED: 'Return Pending',
  CANCELLED: null,
};

@Injectable()
export class CourierWebhookService {
  private readonly logger = new Logger(CourierWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    private readonly manager: CourierManagerService,
    private readonly cancelReturnStock: CancelReturnStockService,
  ) {}

  /**
   * Task 4 status discipline: malformed payloads throw 400, unknown
   * consignments throw 404. Rationale (owner-locked 404, mitigations exist):
   * Steadfast docs are EXPLICIT — "A 4xx answer is not retried" (SteadFast
   * Webhooks Docs, Answers and retries); Pathao / RedX / Carrybee webhook
   * docs are SILENT on retry (ASSUMED no 4xx retry — no contrary statement
   * found), so a 404 ends the retry loop instead of hammering us. The
   * residual risk (dispatch row created AFTER the webhook) is covered
   * structurally — manual dispatch rows and
   * the fillManualDispatchIdentifiers backfill exist precisely for that —
   * and every miss is LOUD-logged + visible in the webhook-attempts UI for
   * staff reconciliation. Only transient failures (DB down, etc.) surface
   * as 5xx, via the controller's non-HttpException branch.
   */
  async handleSteadfast(body: Record<string, unknown>) {
    const notificationType = body['notification_type'] as string;
    const consignmentId = String(body['consignment_id'] ?? '').trim();

    if (!consignmentId) {
      this.logger.warn('Steadfast webhook missing consignment_id');
      throw new BadRequestException('Missing consignment_id');
    }

    const order = await this.findSteadfastOrder(
      consignmentId,
      (body['invoice'] as string) || undefined,
    );
    if (!order) {
      this.logger.warn(`Steadfast: Order not found for consignment ${consignmentId}`);
      throw new NotFoundException(`Order not found for consignment ${consignmentId}`);
    }

    // Handle tracking_update — just add timeline entry, no status change
    if (notificationType === 'tracking_update') {
      const trackingMsg = (body['tracking_message'] as string) || 'Tracking update';
      await this.fillManualDispatchIdentifiers(
        order.id,
        'steadfast',
        consignmentId,
        (body['tracking_code'] as string) || undefined,
      );
      await this.addTimelineEntry(order.id, 'steadfast', trackingMsg);
      this.logger.log(`Steadfast tracking: ${consignmentId} — ${trackingMsg}`);
      return { status: 'success', message: 'Tracking update received' };
    }

    const rawStatus = (body['status'] as string)?.toLowerCase() || '';
    let dispatchStatus: string | null = STEADFAST_DISPATCH_MAP[rawStatus];

    if (rawStatus === 'cancelled') {
      dispatchStatus = await this.resolveCancelledStatus(order.id);
    }

    // Task 5 (owner-locked): `exceptional` = lost, damaged or otherwise off
    // the normal path. No EXCEPTION value exists in DispatchStatus, so the
    // previous workflow status is KEPT (never HOLD/DELIVERED/settle) with a
    // loud log + staff alert. Return statuses never arrive via webhook (the
    // SteadFast Webhooks Docs delivery_status vocabulary is only
    // pending/delivered/partial_delivered/cancelled/unknown) — those
    // reconcile solely through reconcileSteadfastReturn (return-status
    // endpoint), never here.
    if (rawStatus === 'exceptional') {
      return this.handleExceptional(order.id, consignmentId, body);
    }

    if (!dispatchStatus) {
      this.logger.log(`Steadfast: ${consignmentId} status "${rawStatus}" → skipped`);
      return { status: 'success', message: 'No status change needed' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { courierStatus: rawStatus, courierService: 'steadfast' },
    });

    await this.fillManualDispatchIdentifiers(
      order.id,
      'steadfast',
      consignmentId,
      (body['tracking_code'] as string) || undefined,
    );
    await this.upsertDispatch(order.id, 'steadfast', consignmentId, dispatchStatus, body, rawStatus);

    await this.addTimelineEntry(order.id, 'steadfast', dispatchStatus);

    const orderStatusName = DISPATCH_TO_ORDER_STATUS[dispatchStatus];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(order.id, orderStatusName);
    }

    this.logger.log(`Steadfast: ${consignmentId} → dispatch=${dispatchStatus} order=${orderStatusName || '-'}`);
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  /**
   * Task 5 (owner-locked): Steadfast `exceptional` — lost, damaged or
   * otherwise off the normal path ("Contact support").
   *
   * No EXCEPTION value exists in the DispatchStatus enum (verified in
   * schema.prisma), so the previous workflow status is KEPT: no Dispatch
   * status write, no order advancement, no settlement effect. The alert
   * surface is the order timeline + the raw `courierStatus` (visible in the
   * Dispatch list "Courier Status" column) + a loud error log. A dedicated
   * admin badge was considered and rejected: Dispatch.flaggedAt drives the
   * duplicate-dispatch resolve flow (accept/accessories/cancel) and
   * CodMismatchBanner is COD-specific — overloading either would corrupt
   * its semantics.
   */
  private async handleExceptional(
    orderId: string,
    consignmentId: string,
    body: Record<string, unknown>,
  ) {
    const prev = await this.prisma.dispatch.findFirst({
      where: {
        orderId,
        courier: 'steadfast' as any,
        consignmentId,
      },
      select: { id: true, status: true },
    });
    if (prev) {
      await this.prisma.dispatch.update({
        where: { id: prev.id },
        data: { courierStatus: 'exceptional', lastSyncedAt: new Date() },
      });
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { courierStatus: 'exceptional', courierService: 'steadfast' },
    });

    await this.fillManualDispatchIdentifiers(
      orderId,
      'steadfast',
      consignmentId,
      (body['tracking_code'] as string) || undefined,
    );
    await this.addTimelineEntry(orderId, 'steadfast', 'exceptional', {
      remarks:
        `Parcel lost, damaged or off the normal path — dispatch status kept ` +
        `(${prev?.status ?? 'unknown'}); contact Steadfast support`,
    });

    this.logger.error(
      `Steadfast EXCEPTION: consignment ${consignmentId} (order ${orderId}) ` +
        `is off the normal path — workflow status kept (${prev?.status ?? 'unknown'}), ` +
        `staff alert raised on the order timeline`,
    );
    return { status: 'success', message: 'Exception recorded — status kept, staff alerted' };
  }

  /**
   * Task 5 (owner-locked): Steadfast return reconciliation, sourced ONLY
   * from GET /status_with_return_status_by_cid (the only endpoint that
   * reports how far back a parcel has got).
   *
   * - cancelled in-flight (processing/rider_assigned) → RETURN_PENDING.
   * - cancelled received ("you have it back") → RETURNED + stock reconcile.
   * - partial_* keep PARTIAL + return state; received → stock reconcile.
   * - *_received never marks COD owed (a returned parcel collects nothing).
   * - 'Returned' stays manual-confirmation-only: the reconcile never sets
   *   the order status to Returned (OrdersService blocks automated actors);
   *   staff confirms it from the order detail page afterwards. Stock is
   *   restored now because the courier API itself confirms physical receipt.
   */
  async reconcileSteadfastReturn(input: { consignmentId: string }) {
    const consignmentId = String(input?.consignmentId ?? '').trim();
    if (!consignmentId) {
      throw new BadRequestException('Missing consignment_id');
    }

    const { deliveryStatus } = await this.manager.getSteadfastReturnStatus(consignmentId);
    const rawStatus = String(deliveryStatus || '').toLowerCase();
    const mapped = mapSteadfastReturnStatus(rawStatus);
    if (!mapped) {
      return {
        reconciled: false as const,
        deliveryStatus: rawStatus,
        reason: 'Not a return status — use the normal courier sync for this label',
      };
    }

    const order = await this.findSteadfastOrder(consignmentId);
    if (!order) {
      this.logger.warn(`Steadfast return-reconcile: order not found for consignment ${consignmentId}`);
      throw new NotFoundException(`Order not found for consignment ${consignmentId}`);
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { courierStatus: rawStatus, courierService: 'steadfast' },
    });

    await this.fillManualDispatchIdentifiers(order.id, 'steadfast', consignmentId);
    await this.upsertDispatch(order.id, 'steadfast', consignmentId, mapped.dispatchStatus, {}, rawStatus);

    await this.addTimelineEntry(order.id, 'steadfast', mapped.dispatchStatus, {
      return_type: rawStatus,
      remarks: mapped.reconcileStock
        ? 'Parcel back with the merchant — stock reconciled; confirm Returned manually'
        : 'Return in progress — stock held, nothing restored yet',
    });

    if (mapped.advanceOrder) {
      await this.tryAdvanceOrderStatus(order.id, mapped.advanceOrder);
    }

    let stockReconciled = false;
    if (mapped.reconcileStock) {
      await this.prisma.$transaction(async (tx) => {
        await this.cancelReturnStock.restoreForOrder({
          orderId: order.id,
          referencePrefix: 'return',
          performedBy: 'system',
          tx: tx as Prisma.TransactionClient,
        });
      });
      stockReconciled = true;
    }

    this.logger.log(
      `Steadfast return-reconcile: ${consignmentId} → dispatch=${mapped.dispatchStatus} ` +
        `stock=${stockReconciled ? 'reconciled' : 'held'} codOwed=false`,
    );
    return {
      reconciled: true as const,
      deliveryStatus: rawStatus,
      dispatchStatus: mapped.dispatchStatus,
      stockReconciled,
      codOwed: false as const,
    };
  }

  /**
   * Resolve the order for a Steadfast webhook by consignment id.
   *
   * Fallback chain (primary path unchanged, all steps additive):
   * 1. Order.courierConsignmentId — populated by the automated API dispatch
   *    and bulk-dispatch flows.
   * 2. Dispatch registry — consignments entered via the manual Dispatch
   *    creation flow, Steadfast-portal-side bookings logged manually, or
   *    imports live ONLY on the Dispatch row (unique per courier + consignment)
   *    and never touch Order.courierConsignmentId.
   * 3. Documented `invoice` identifier — the API dispatch flow sends
   *    Order.displayId as the Steadfast invoice, so it re-links orders whose
   *    consignment identifier no longer matches (mirrors the RedX handler).
   */
  private async findSteadfastOrder(
    consignmentId: string,
    invoice?: string,
  ): Promise<{ id: string } | null> {
    const direct = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId, trashedAt: null },
    });
    if (direct) return direct;

    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        courier: 'steadfast' as any,
        consignmentId,
        order: { trashedAt: null },
      },
      select: { orderId: true },
    });
    if (dispatch) {
      const viaDispatch = await this.prisma.order.findUnique({
        where: { id: dispatch.orderId },
      });
      if (viaDispatch && !viaDispatch.trashedAt) return viaDispatch;
    }

    if (invoice) {
      const viaInvoice = await this.prisma.order.findFirst({
        where: {
          displayId: invoice,
          courierService: 'steadfast',
          trashedAt: null,
        },
      });
      if (viaInvoice) return viaInvoice;
    }

    return null;
  }

  private async resolveCancelledStatus(orderId: string): Promise<string> {
    const hasProgress = await this.prisma.dispatch.findFirst({
      where: {
        orderId,
        status: { in: ['HANDED_OVER', 'PICKED_UP', 'IN_TRANSIT', 'ASSIGNED_TO_RIDER', 'DELIVERED', 'PARTIAL'] },
      },
    });
    return hasProgress ? 'RETURN_PENDING' : 'CANCELLED';
  }

  /**
   * Backfill a manual Dispatch row created before the courier booking existed
   * (NULL identifiers) with the webhook's identifiers. No-op when no such row
   * exists, or when a row already owns the consignment (the upsert path owns
   * that case — filling too would collide on the unique key).
   */
  private async fillManualDispatchIdentifiers(
    orderId: string,
    courier: string,
    consignmentId: string,
    trackingCode?: string,
  ): Promise<void> {
    if (!consignmentId) return;
    const owned = await this.prisma.dispatch.findFirst({
      where: { courier: courier as any, consignmentId },
      select: { id: true },
    });
    if (owned) return;
    const manual = await this.prisma.dispatch.findFirst({
      where: { orderId, courier: courier as any, consignmentId: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!manual) return;
    await this.prisma.dispatch.update({
      where: { id: manual.id },
      data: {
        consignmentId,
        ...(trackingCode ? { trackingCode } : {}),
      },
    });
    this.logger.log(
      `${courier}: backfilled identifiers on manual dispatch ${manual.id} (order ${orderId}, consignment ${consignmentId})`,
    );
  }

  private async upsertDispatch(
    orderId: string,
    courier: string,
    consignmentId: string,
    status: string,
    body: Record<string, unknown>,
    rawStatus?: string | null,
  ) {
    const trackingCode = (body['tracking_code'] as string) || undefined;
    await this.prisma.dispatch.upsert({
      where: {
        courier_consignmentId: { courier: courier as any, consignmentId },
      },
      update: {
        status: status as any,
        trackingCode,
        // Persist the courier's raw running status against the dispatch so the
        // Dispatch list "Courier Status" column reflects the latest state even
        // before a manual sync. DispatchStatus (`status`) stays separate.
        ...(rawStatus ? { courierStatus: rawStatus, lastSyncedAt: new Date() } : {}),
      },
      create: {
        orderId,
        courier: courier as any,
        consignmentId,
        trackingCode,
        status: status as any,
        courierStatus: rawStatus || null,
        lastSyncedAt: new Date(),
      },
    });

    // Stamp the pickup/delivery event timestamps. These columns are the
    // authoritative event times for KPI/reporting queries; only the manual
    // dispatch board used to set them, so courier-driven progression left
    // them NULL. First write wins (a repeated webhook for the same event
    // must not move the original timestamp). Any post-pickup status counts
    // as pickup — webhooks often skip order.picked entirely
    // (order.in-transit / order.delivered with no prior pickup event).
    if (impliesPickup(status)) {
      await this.prisma.dispatch.updateMany({
        where: { courier: courier as any, consignmentId, pickedUpAt: null },
        data: { pickedUpAt: new Date() },
      });
    }
    if (status === 'DELIVERED') {
      await this.prisma.dispatch.updateMany({
        where: { courier: courier as any, consignmentId, deliveredAt: null },
        data: { deliveredAt: new Date() },
      });
    }
  }

  private async tryAdvanceOrderStatus(orderId: string, targetName: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order || order.trashedAt) return;

    const currentIdx = ORDER_STATUS_FLOW.indexOf(order.status.name);
    const targetIdx = ORDER_STATUS_FLOW.indexOf(targetName);
    if (currentIdx < 0 || targetIdx < 0) return;
    if (currentIdx >= targetIdx) return;

    const targetStatus = await this.prisma.orderStatus.findUnique({
      where: { name: targetName },
    });
    if (!targetStatus) return;

    try {
      await this.ordersService.updateStatus(orderId, { statusId: targetStatus.id }, 'system');
      return;
    } catch (e) {
      this.logger.warn(`Direct transition to ${targetName} failed: ${(e as Error).message}`);
    }

    const path = this.findTransitionPath(order.status.name, targetName);
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
      const allowed = ORDER_TRANSITIONS[current.status.name] || [];
      if (!allowed.includes(step)) continue;
      try {
        await this.ordersService.updateStatus(orderId, { statusId: stepStatus.id }, 'system');
      } catch (e2) {
        this.logger.warn(`Step ${current.status.name}→${step} failed: ${(e2 as Error).message}`);
        break;
      }
    }
  }

  private findTransitionPath(from: string, to: string): string[] {
    const visited = new Set<string>();
    const queue: { status: string; path: string[] }[] = [{ status: from, path: [] }];
    visited.add(from);

    while (queue.length > 0) {
      const { status, path } = queue.shift()!;
      const allowed = ORDER_TRANSITIONS[status] || [];
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

  private async addTimelineEntry(
    orderId: string,
    courier: string,
    status: string,
    extra?: Record<string, unknown>,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, trashedAt: null },
    });
    if (!order) return;
    const entry: Record<string, unknown> = {
      type: 'courier',
      courier,
      status,
      timestamp: new Date().toISOString(),
      note: `${courier}: ${status}`,
    };
    if (extra?.reason) entry.reason = extra.reason;
    if (extra?.collected_amount != null) entry.collectedAmount = extra.collected_amount;
    if (extra?.return_type) entry.returnType = extra.return_type;
    if (extra?.return_consignment_id) entry.returnConsignmentId = extra.return_consignment_id;
    // Task 5: RedX `paid` money event — the merchant invoice id rides the
    // timeline entry so the settlement feed can match it (no new tables).
    if (extra?.invoice_number) entry.invoiceNumber = extra.invoice_number;
    if (extra?.remarks) entry.remarks = extra.remarks;
    if (extra?.attempt != null) entry.attempt = extra.attempt;
    if (extra?.agent_name) entry.agentName = extra.agent_name;
    if (extra?.agent_phone) entry.agentPhone = extra.agent_phone;
    const timeline = [
      ...((order.timeline as unknown[]) || []),
      entry,
    ];
    await this.prisma.order.update({
      where: { id: orderId },
      data: { timeline: timeline as Prisma.InputJsonValue },
    });
  }

  async handlePathao(body: Record<string, unknown>) {
    const event = body['event'] as string;

    if (event === 'webhook_integration') {
      this.logger.log('Pathao webhook integration test received');
      return { status: 'success', message: 'Webhook integration successful' };
    }

    if (event?.startsWith('store.')) {
      return { status: 'success', message: 'Store event, no action needed' };
    }

    const consignmentId = String(body['consignment_id'] ?? '').trim();
    if (!consignmentId) {
      this.logger.warn('Pathao webhook missing consignment_id');
      throw new BadRequestException('Missing consignment_id');
    }

    const order = await this.findPathaoOrder(
      consignmentId,
      (body['merchant_order_id'] as string) || undefined,
    );
    if (!order) {
      this.logger.warn(`Pathao: Order not found for consignment ${consignmentId}`);
      throw new NotFoundException(`Order not found for consignment ${consignmentId}`);
    }

    let dispatchStatus: string | null = PATHAO_DISPATCH_MAP[event] ?? null;

    if (!dispatchStatus) {
      // Skip-statuses (order.updated, pickup-failed, delivery-failed, …):
      // persist the raw courier state so the Dispatch list "Courier Status"
      // column and the order reflect what really happened, but NEVER force a
      // workflow change (no CANCELLED, no RETURN_PENDING, no cancellation —
      // these events carry no delivery outcome).
      this.logger.log(`Pathao: ${consignmentId} event "${event}" → recorded, workflow unchanged`);
      await this.prisma.order.update({
        where: { id: order.id },
        data: { courierStatus: event, courierService: 'pathao' },
      });

      const existing = await this.prisma.dispatch.findFirst({
        where: {
          courier: 'pathao' as any,
          consignmentId,
        },
        select: { id: true, status: true },
      });
      if (!existing) {
        await this.fillManualDispatchIdentifiers(
          order.id,
          'pathao',
          consignmentId,
          (body['tracking_code'] as string) || undefined,
        );
      }
      if (existing) {
        await this.prisma.dispatch.update({
          where: { id: existing.id },
          data: { courierStatus: event, lastSyncedAt: new Date() },
        });
      }
      await this.addTimelineEntry(order.id, 'pathao', event);
      return { status: 'success', message: 'No status change needed' };
    }

    if (event === 'order.pickup-cancelled') {
      dispatchStatus = await this.resolveCancelledStatus(order.id);
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { courierStatus: event, courierService: 'pathao' },
    });

    await this.fillManualDispatchIdentifiers(
      order.id,
      'pathao',
      consignmentId,
      (body['tracking_code'] as string) || undefined,
    );
    await this.upsertDispatch(order.id, 'pathao', consignmentId, dispatchStatus, body, event);

    const extra: Record<string, unknown> = {};
    if (body['reason']) extra.reason = body['reason'];
    if (body['collected_amount'] != null) extra.collected_amount = body['collected_amount'];
    if (body['return_type']) extra.return_type = body['return_type'];
    if (body['return_consignment_id']) extra.return_consignment_id = body['return_consignment_id'];
    await this.addTimelineEntry(order.id, 'pathao', dispatchStatus, extra);

    const orderStatusName = PATHAO_DISPATCH_TO_ORDER[dispatchStatus];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(order.id, orderStatusName);
    }

    this.logger.log(`Pathao: ${consignmentId} → dispatch=${dispatchStatus} order=${orderStatusName || '-'}`);
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  /**
   * Resolve the order for a Pathao webhook by consignment id — mirrors the
   * Steadfast fallback chain so webhooks for orders from the MANUAL dispatch
   * list (registry-only consignments) and legacy re-links resolve too:
   * 1. Order.courierConsignmentId — automated API / bulk dispatch.
   * 2. Dispatch registry — manual dispatch-list entries whose consignment
   *    lives only on the Dispatch row.
   * 3. merchant_order_id — the documented webhook identifier; the API
   *    dispatch flow sends Order.displayId as merchant_order_id.
   */
  private async findPathaoOrder(
    consignmentId: string,
    merchantOrderId?: string,
  ): Promise<{ id: string } | null> {
    const direct = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId, trashedAt: null },
    });
    if (direct) return direct;

    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        courier: 'pathao' as any,
        consignmentId,
        order: { trashedAt: null },
      },
      select: { orderId: true },
    });
    if (dispatch) {
      const viaDispatch = await this.prisma.order.findUnique({
        where: { id: dispatch.orderId },
      });
      if (viaDispatch && !viaDispatch.trashedAt) return viaDispatch;
    }

    if (merchantOrderId) {
      const viaMerchantId = await this.prisma.order.findFirst({
        where: {
          displayId: merchantOrderId,
          courierService: 'pathao',
          trashedAt: null,
        },
      });
      if (viaMerchantId) return viaMerchantId;
    }

    return null;
  }

  async handleRedx(body: Record<string, unknown>) {
    const trackingNumber = body['tracking_number'] as string;
    const status = (body['status'] as string)?.toLowerCase();
    const invoiceNumber = body['invoice_number'] as string;
    const messageEn = body['message_en'] as string;
    const deliveryType = body['delivery_type'] as string;

    await this.logWebhookRequest('redx', body);

    if (!trackingNumber && !invoiceNumber) {
      this.logger.warn('RedX webhook missing tracking_number and invoice_number');
      throw new BadRequestException('Missing tracking_number');
    }
    let order: {
      id: string;
      courierStatus: string | null;
      courierTrackingCode: string | null;
      courierConsignmentId: string | null;
    } | null = null;
    if (trackingNumber)
      order = await this.prisma.order.findFirst({
        where: { courierTrackingCode: trackingNumber, courierService: 'redx', trashedAt: null },
      });
    if (!order && invoiceNumber)
      order = await this.prisma.order.findFirst({
        where: { displayId: invoiceNumber, courierService: 'redx', trashedAt: null },
      });
    if (!order) {
      this.logger.warn(`RedX: Order not found for tracking ${trackingNumber || invoiceNumber}`);
      throw new NotFoundException(`Order not found for tracking ${trackingNumber || invoiceNumber}`);
    }

    let dispatchStatus: string | null = REDX_DISPATCH_MAP[status] ?? null;

    if (status === 'delivered' && deliveryType === 'partial-delivery') {
      dispatchStatus = 'PARTIAL';
    }

    // Task 5 (owner-locked): RedX `paid` is a MONEY event, not a delivery
    // event. It feeds settlement (the merchant invoice id is stored on the
    // timeline entry + the WebhookAttempt row via the controller meta) and
    // must NEVER change the delivery workflow: no Dispatch status write,
    // no order advancement.
    if (status === 'paid') {
      return this.handleRedxPaid(order.id, trackingNumber, invoiceNumber, body);
    }

    if (!dispatchStatus) {
      this.logger.log(`RedX: ${trackingNumber || invoiceNumber} status "${status}" → skipped`);
      return { status: 'success', message: 'No status change needed' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: status,
        courierTrackingCode: trackingNumber || order.courierTrackingCode,
        courierService: 'redx',
      },
    });

    const consignmentId = trackingNumber || invoiceNumber || '';
    await this.fillManualDispatchIdentifiers(order.id, 'redx', consignmentId);
    await this.upsertDispatch(order.id, 'redx', consignmentId, dispatchStatus, body, status);

    const extra: Record<string, unknown> = {};
    if (messageEn) extra.remarks = messageEn;
    if (deliveryType) extra.delivery_type = deliveryType;
    await this.addTimelineEntry(order.id, 'redx', dispatchStatus, extra);

    const orderStatusName = REDX_DISPATCH_TO_ORDER[dispatchStatus];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(order.id, orderStatusName);
    }

    this.logger.log(`RedX: ${trackingNumber || invoiceNumber} → dispatch=${dispatchStatus} order=${orderStatusName || '-'}${messageEn ? ` (${messageEn})` : ''}`);
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  /**
   * Task 5 (owner-locked): RedX `paid` money event → settlement feed.
   * Stores the merchant invoice id (settlement matching key) on the raw
   * courier state + timeline; the delivery workflow is untouched.
   */
  private async handleRedxPaid(
    orderId: string,
    trackingNumber: string | undefined,
    invoiceNumber: string | undefined,
    body: Record<string, unknown>,
  ) {
    const consignmentId = trackingNumber || invoiceNumber || '';

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        courierStatus: 'paid',
        courierTrackingCode: trackingNumber || undefined,
        courierService: 'redx',
      },
    });

    const existing = await this.prisma.dispatch.findFirst({
      where: { courier: 'redx' as any, consignmentId },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.dispatch.update({
        where: { id: existing.id },
        data: { courierStatus: 'paid', lastSyncedAt: new Date() },
      });
    } else {
      await this.fillManualDispatchIdentifiers(orderId, 'redx', consignmentId);
    }

    await this.addTimelineEntry(orderId, 'redx', 'paid', {
      invoice_number: invoiceNumber,
      remarks: body['message_en'] as string | undefined,
    });

    this.logger.log(
      `RedX MONEY event: parcel ${consignmentId} paid (invoice ${invoiceNumber || 'unknown'}) — ` +
        `recorded for settlement, no delivery-status change`,
    );
    return { status: 'success', message: 'Payment recorded — no delivery-status change' };
  }

  async handleCarrybee(body: Record<string, unknown>) {
    const event = body['event'] as string;

    if (event === 'webhook_integration') {
      this.logger.log('Carrybee webhook integration test received');
      return { status: 'success', message: 'Webhook integration successful' };
    }

    const consignmentId = body['consignment_id'] as string;
    if (!consignmentId) {
      this.logger.warn('Carrybee webhook missing consignment_id');
      throw new BadRequestException('Missing consignment_id');
    }

    const order = await this.findCarrybeeOrder(consignmentId);
    if (!order) {
      // Portal-side bookings never stamp the Order row and carry no invoice
      // fallback — nothing can be matched. Say so LOUDLY and leave the manual
      // row (if any) blank rather than fabricating identifiers.
      this.logger.warn(
        `Carrybee: UNMATCHED webhook — no Order or manual Dispatch row for consignment ${consignmentId} (courier=carrybee, event=${event}). Leaving identifiers blank; create the dispatch from admin or stamp the Order row.`,
      );
      throw new NotFoundException(`Order not found for consignment ${consignmentId}`);
    }

    let dispatchStatus: string | null = CARRYBEE_DISPATCH_MAP[event] ?? null;

    if (['order.pickup-failed', 'order.delivery-failed'].includes(event)) {
      dispatchStatus = await this.resolveCancelledStatus(order.id);
    }

    if (!dispatchStatus) {
      this.logger.log(`Carrybee: ${consignmentId} event "${event}" → skipped`);
      return { status: 'success', message: 'No status change needed' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { courierStatus: event, courierService: 'carrybee' },
    });

    await this.fillManualDispatchIdentifiers(order.id, 'carrybee', consignmentId);

    await this.upsertDispatch(order.id, 'carrybee', consignmentId, dispatchStatus, body, event);

    const extra: Record<string, unknown> = {};
    if (body['reason']) extra.reason = body['reason'];
    if (body['collected_amount'] != null) extra.collected_amount = body['collected_amount'];
    if (body['remarks']) extra.remarks = body['remarks'];
    if (body['attempt'] != null) extra.attempt = body['attempt'];
    if (body['agent_name']) extra.agent_name = body['agent_name'];
    if (body['agent_phone']) extra.agent_phone = body['agent_phone'];
    await this.addTimelineEntry(order.id, 'carrybee', dispatchStatus, extra);

    const orderStatusName = CARRYBEE_DISPATCH_TO_ORDER[dispatchStatus];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(order.id, orderStatusName);
    }

    this.logger.log(`Carrybee: ${consignmentId} → dispatch=${dispatchStatus} order=${orderStatusName || '-'}`);
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  /**
   * Resolve the order for a Carrybee webhook by consignment id:
   * 1. Order.courierConsignmentId — automated API dispatch.
   * 2. Dispatch registry — staff pre-created rows carrying identifiers whose
   *    order claim was skipped (claimed by a different consignment).
   * Portal bookings with neither stay unmatchable by design (loud warn above).
   */
  private async findCarrybeeOrder(
    consignmentId: string,
  ): Promise<{ id: string } | null> {
    const direct = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId, trashedAt: null },
    });
    if (direct) return direct;

    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        courier: 'carrybee' as any,
        consignmentId,
        order: { trashedAt: null },
      },
      select: { orderId: true },
    });
    if (dispatch) {
      const viaDispatch = await this.prisma.order.findUnique({
        where: { id: dispatch.orderId },
      });
      if (viaDispatch && !viaDispatch.trashedAt) return viaDispatch;
    }

    return null;
  }

  private logWebhookRequest(courier: string, body: Record<string, unknown>) {
    const tracking =
      body['tracking_number'] ||
      body['tracking_id'] ||
      body['consignment_id'] ||
      'unknown';
    const invoice =
      body['invoice_number'] ||
      body['merchant_invoice_id'] ||
      body['invoice'] ||
      'unknown';
    this.logger.log(
      `Webhook ${courier}: tracking=${tracking} invoice=${invoice} status=${body['status'] || body['event'] || 'unknown'}`,
    );
  }
}

export function buildTrackingUrl(
  courier: string | null,
  trackingCode: string | null,
  consignmentId: string | null,
): string | null {
  if (!trackingCode && !consignmentId) return null;
  const service = (courier || '').toLowerCase();
  switch (service) {
    case 'steadfast':
      return `https://steadfast.com.bd/t/${encodeURIComponent(consignmentId || trackingCode || '')}`;
    case 'pathao':
      return `https://merchant.pathao.com/tracking?consignment_id=${encodeURIComponent(consignmentId || trackingCode || '')}`;
    case 'redx':
      return `https://redx.com.bd/track-global-parcel/?trackingId=${encodeURIComponent(trackingCode || consignmentId || '')}`;
    case 'carrybee':
      return `https://merchant.carrybee.com/order-track/${encodeURIComponent(consignmentId || trackingCode || '')}`;
    default:
      return null;
  }
}
