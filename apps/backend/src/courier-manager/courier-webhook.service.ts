import { Injectable, Logger, Inject, forwardRef, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { CourierManagerService } from './courier-manager.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { CodMismatchService } from '../cod-mismatch/cod-mismatch.service';
import { mapSteadfastReturnStatus } from './courier-status-mapper';
import { normalizeInvoiceForCompare } from './courier-settle-guard';
import { impliesPickup } from '../dispatch/dispatch-timestamps';

const ORDER_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['Payment Pending', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Pending': ['Payment Verifying', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Verifying': ['Confirmed', 'Hold', 'Cancelled'],
  'Hold': ['Pending', 'Confirmed', 'Cancelled'],
  'Confirmed': ['Packed', 'Packing Hold', 'Cancelled'],
  'Packed': ['Shipping', 'Packing Hold'],
  'Packing Hold': ['Packed', 'Cancelled'],
  // Task A (owner-locked): Shipping → Return Pending is DIRECT (a parcel can
  // turn back without ever delivering). The previous map forced the fallback
  // path through Delivered — now forbidden (see tryAdvanceOrderStatus guard).
  'Shipping': ['Delivered', 'Partial', 'Return Pending'],
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
  // Task A (owner-locked): "unknown" is NOT a cancellation — null yields the
  // skip path, which records the raw state + timeline + loud alert and keeps
  // the previous workflow status (sync mapper returns null for it too).
  unknown: null,
};

// Task A (extra c): Steadfast informational notification types — recorded
// (raw + timeline + log), never a workflow change. Return-linking is MINIMAL
// (ids on the timeline + log); the full Return entity is T6, not built here.
const STEADFAST_RECORD_ONLY_TYPES = new Set([
  'return_list_accepted',
  'payment_request',
  'cancel_request',
  'return_request',
  'pickup_request',
  'user_update',
]);

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
  // Task A (owner-locked): `ready-for-delivery` = parcel received from the
  // merchant, rider not yet assigned — ASSIGNED_TO_RIDER (was PICKED_UP),
  // order stays Shipping via REDX_DISPATCH_TO_ORDER.
  'ready-for-delivery': 'ASSIGNED_TO_RIDER',
  'delivery-in-progress': 'ASSIGNED_TO_RIDER',
  delivered: 'DELIVERED',
  // AUTHORITATIVE RULE: PARTIAL → 'Partial' for every courier, no exception.
  partial: 'PARTIAL',
  partial_delivered: 'PARTIAL',
  'agent-hold': 'HOLD',
  'agent-returning': 'RETURN_PENDING',
  returned: 'RETURN_PENDING',
  // Task 1 (owner-locked, paid = DELIVERED): RedX `paid` advances the
  // delivery workflow AND keeps the money recording (handled in
  // handleRedxPaid, which upserts DELIVERED + advances the order while
  // storing invoice_number on the timeline + WebhookAttempt meta).
  'paid': 'DELIVERED',
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
    @Optional() private readonly codMismatch?: CodMismatchService,
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

    // Task A (extras b/c): consignment_update + informational types branch
    // BEFORE the parcel-key requirement — user_update / payment_request /
    // pickup_request / return_list_accepted carry no consignment_id.
    if (notificationType === 'consignment_update') {
      return this.handleConsignmentUpdate(body);
    }
    if (STEADFAST_RECORD_ONLY_TYPES.has(notificationType)) {
      return this.handleSteadfastRecordOnly(body);
    }

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

    // Task A (F3): "unknown" — the courier cannot determine the state. Record
    // raw + timeline + loud alert, keep the previous workflow status (never
    // CANCELLED, never an order advance).
    if (rawStatus === 'unknown') {
      return this.handleUnknownSteadfast(order.id, consignmentId, body);
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
   * Task A (F3, owner-locked): Steadfast `unknown` — the courier explicitly
   * reports it cannot determine the parcel state. NOT a cancellation: keep
   * the previous workflow status (no Dispatch status write, no order
   * advancement, no settlement effect). Alert surface mirrors `exceptional`:
   * raw courierStatus on order + dispatch, timeline alert, loud error log.
   */
  private async handleUnknownSteadfast(
    orderId: string,
    consignmentId: string,
    body: Record<string, unknown>,
  ) {
    await this.prisma.order.update({
      where: { id: orderId },
      data: { courierStatus: 'unknown', courierService: 'steadfast' },
    });

    const existing = await this.prisma.dispatch.findFirst({
      where: {
        courier: 'steadfast' as any,
        consignmentId,
      },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.dispatch.update({
        where: { id: (existing as any).id },
        data: { courierStatus: 'unknown', lastSyncedAt: new Date() },
      });
    } else {
      await this.fillManualDispatchIdentifiers(
        orderId,
        'steadfast',
        consignmentId,
        (body['tracking_code'] as string) || undefined,
      );
    }

    await this.addTimelineEntry(orderId, 'steadfast', 'unknown', {
      remarks:
        `Courier reports state unknown — dispatch status kept; ` +
        `needs staff review`,
    });

    this.logger.error(
      `Steadfast UNKNOWN: consignment ${consignmentId} (order ${orderId}) ` +
        `state unknown — workflow status kept, staff alert raised on the order timeline`,
    );
    return { status: 'success', message: 'Unknown state recorded — status kept, staff alerted' };
  }

  /**
   * Task A (extra b, owner-locked): `consignment_update` — the merchant
   * changed the parcel (address or COD) via the Steadfast dashboard. Applies
   * changed[]/values to our fields with NO status change (no dispatch status
   * write, no order advancement). A COD change refreshes the courier-side
   * Dispatch.courierAmount and recomputes the COD mismatch (systemDue is
   * untouched — only the courier-side amount moved).
   */
  private async handleConsignmentUpdate(body: Record<string, unknown>) {
    const consignmentId = String(body['consignment_id'] ?? '').trim();
    const invoice = (body['invoice'] as string) || undefined;
    if (!consignmentId && !invoice) {
      this.logger.warn('Steadfast consignment_update missing consignment_id and invoice');
      throw new BadRequestException('Missing consignment_id');
    }

    const order = await this.findSteadfastOrder(consignmentId, invoice);
    if (!order) {
      this.logger.warn(
        `Steadfast consignment_update: order not found for consignment ${consignmentId || invoice}`,
      );
      throw new NotFoundException(`Order not found for consignment ${consignmentId || invoice}`);
    }

    const changed = Array.isArray(body['changed'])
      ? (body['changed'] as unknown[]).map((v) => String(v))
      : [];
    const values = (body['values'] as Record<string, unknown>) || {};

    // Address change → merge into the order-owned shippingAddress snapshot.
    const addressKey = changed.find((k) => ['cus_address', 'recipient_address', 'address'].includes(k));
    if (addressKey && values[addressKey] != null) {
      const full = await this.prisma.order.findUnique({ where: { id: (order as any).id } });
      const existingAddr = (full as any)?.shippingAddress;
      const base =
        typeof existingAddr === 'object' && existingAddr !== null ? existingAddr : {};
      const newAddress = String(values[addressKey]);
      await this.prisma.order.update({
        where: { id: (order as any).id },
        data: {
          shippingAddress: { ...base, address: newAddress, addressLine: newAddress } as any,
        },
      });
    }

    // COD change → refresh courier-side amount + recompute the mismatch.
    const codKey = changed.find((k) => ['cod_amount', 'cod', 'collectable_amount'].includes(k));
    if (codKey && values[codKey] != null && !Number.isNaN(Number(values[codKey]))) {
      if (consignmentId) {
        const dispatch = await this.prisma.dispatch.findFirst({
          where: { courier: 'steadfast' as any, consignmentId },
          select: { id: true },
        });
        if (dispatch) {
          await this.prisma.dispatch.update({
            where: { id: (dispatch as any).id },
            data: { courierAmount: Number(values[codKey]) },
          });
        }
      }
      await this.codMismatch?.recompute((order as any).id);
    }

    await this.fillManualDispatchIdentifiers(
      (order as any).id,
      'steadfast',
      consignmentId,
      (body['tracking_id'] as string) || undefined,
    );
    await this.addTimelineEntry((order as any).id, 'steadfast', 'consignment_update', {
      remarks: `Changed: ${changed.join(', ') || 'unknown'} — values applied, no status change`,
    });

    this.logger.log(
      `Steadfast consignment_update: ${consignmentId || invoice} changed=[${changed.join(',')}] — applied, workflow unchanged`,
    );
    return { status: 'success', message: 'Consignment update recorded' };
  }

  /**
   * Task A (extra c, owner-locked): informational Steadfast notification
   * types — return_list_accepted / payment_request / cancel_request /
   * return_request / pickup_request / user_update. Recorded (timeline + log),
   * never a workflow change. Return-linking is MINIMAL: the courier return
   * ids ride the timeline entry + log; the full Return entity is T6.
   */
  private async handleSteadfastRecordOnly(body: Record<string, unknown>) {
    const notificationType = body['notification_type'] as string;
    const consignmentId = String(body['consignment_id'] ?? '').trim();
    const invoice = (body['invoice'] as string) || undefined;

    const extra: Record<string, unknown> = {};
    for (const k of [
      'return_list_id', 'return_request_id', 'payment_request_id',
      'cancel_request_id', 'pickup_request_id', 'status', 'item_count',
      'amount', 'method', 'note', 'reason', 'reason_id', 'verify_status',
      'address_id', 'pickup_location', 'service_type', 'estimated_qty',
      'consignments',
    ]) {
      if (body[k] != null) extra[k] = body[k];
    }

    let order: { id: string } | null = null;
    if (consignmentId || invoice) {
      order = await this.findSteadfastOrder(consignmentId, invoice);
    }

    if (order) {
      if (consignmentId || invoice) {
        await this.fillManualDispatchIdentifiers(
          (order as any).id,
          'steadfast',
          consignmentId || (invoice as string),
        );
      }
      await this.addTimelineEntry((order as any).id, 'steadfast', notificationType, {
        ...extra,
        remarks: `${notificationType} recorded — no status change`,
      });
    }

    this.logger.log(
      `Steadfast ${notificationType}: consignment ${consignmentId || invoice || 'n/a'} ` +
        `recorded, workflow unchanged` +
        (order ? '' : ' (no linked order — account-level or unmatched)'),
    );
    return { status: 'success', message: 'Informational event recorded' };
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
      // Task 10: tolerate server-cut text — the courier truncates long
      // invoices (Steadfast: 100); compare the cut form (dispatch now sends
      // the truncated invoice, so this matches what the courier holds).
      const cutInvoice = normalizeInvoiceForCompare(invoice);
      const viaInvoice = await this.prisma.order.findFirst({
        where: {
          displayId: cutInvoice,
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

    // Task A (owner-locked F11): Shipping → Return Pending is direct-or-
    // not-at-all. Walking through Delivered as a stepping stone would briefly
    // mark a returned parcel delivered (Delivered side effects: COD, stock,
    // notifications) — never do that. Staff-visible: timeline note + loud log.
    if (order.status.name === 'Shipping' && targetName === 'Return Pending') {
      this.logger.warn(
        `Shipping → Return Pending direct transition failed for order ${orderId} — ` +
          `NOT stepping via Delivered; needs staff review`,
      );
      await this.addTimelineEntry(orderId, 'system', 'Return Pending', {
        remarks:
          `Shipping → Return Pending direct transition failed; ` +
          `not stepped via Delivered — needs staff review`,
      });
      return;
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
    // Task 1 (owner-locked, paid = DELIVERED + money): the merchant invoice
    // id rides the timeline entry so the settlement feed can match it
    // (no new tables). Handlers map invoice_id → invoice_number; redx sends
    // invoice_number natively.
    if (extra?.invoice_number) entry.invoiceNumber = extra.invoice_number;
    // Task 1: carrybee paid payment_status rides the timeline (no new table).
    if (extra?.payment_status) entry.paymentStatus = extra.payment_status;
    if (extra?.remarks) entry.remarks = extra.remarks;
    // Task A (extras c/d): informational + fee fields ride the timeline entry
    // (no new tables — T6 owns the full Return entity).
    if (extra?.delivery_fee != null) entry.deliveryFee = extra.delivery_fee;
    if (extra?.return_list_id) entry.returnListId = extra.return_list_id;
    if (extra?.return_request_id) entry.returnRequestId = extra.return_request_id;
    if (extra?.payment_request_id) entry.paymentRequestId = extra.payment_request_id;
    if (extra?.cancel_request_id) entry.cancelRequestId = extra.cancel_request_id;
    if (extra?.pickup_request_id) entry.pickupRequestId = extra.pickup_request_id;
    // Task A (extra a): a courier PICKED_UP implies the parcel left our hands —
    // mark the HANDOVER stage complete on the timeline (Dispatch.handedOverAt
    // is the data marker, set only by the explicit handover scan; the timeline
    // note is the courier-driven completion signal).
    if (status === 'PICKED_UP') {
      const handoverNote = 'HANDOVER stage complete (courier pickup implies handover done)';
      entry.remarks = entry.remarks ? `${entry.remarks} | ${handoverNote}` : handoverNote;
    }
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
      // Task A (extra d): order.updated carries the current delivery_fee —
      // record the change on the timeline (still no status change, no
      // dispatch workflow write).
      const skipExtra: Record<string, unknown> = {};
      if (body['delivery_fee'] != null) skipExtra.delivery_fee = body['delivery_fee'];
      if (body['reason']) skipExtra.reason = body['reason'];
      if (body['collected_amount'] != null) skipExtra.collected_amount = body['collected_amount'];
      await this.addTimelineEntry(order.id, 'pathao', event, skipExtra);
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
    // Task 1 (owner-locked, paid = DELIVERED + money): the Pathao order.paid
    // sample carries invoice_id (no amount — identifiers only). It rides the
    // timeline entry (→ invoiceNumber, settlement-matching key, no new table)
    // + the WebhookAttempt meta via the controller.
    if (body['invoice_id'] != null && body['invoice_id'] !== '') extra.invoice_number = body['invoice_id'];
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
      // Task 10: tolerate server-cut text (cut form documented in
      // courier-settle-guard.normalizeInvoiceForCompare).
      const cutId = normalizeInvoiceForCompare(merchantOrderId);
      const viaMerchantId = await this.prisma.order.findFirst({
        where: {
          displayId: cutId,
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
      // Task 10: tolerate server-cut text (cut form documented in
      // courier-settle-guard.normalizeInvoiceForCompare).
      order = await this.prisma.order.findFirst({
        where: { displayId: normalizeInvoiceForCompare(invoiceNumber), courierService: 'redx', trashedAt: null },
      });
    if (!order) {
      this.logger.warn(`RedX: Order not found for tracking ${trackingNumber || invoiceNumber}`);
      throw new NotFoundException(`Order not found for tracking ${trackingNumber || invoiceNumber}`);
    }

    let dispatchStatus: string | null = REDX_DISPATCH_MAP[status] ?? null;

    if (status === 'delivered' && deliveryType === 'partial-delivery') {
      dispatchStatus = 'PARTIAL';
    }

    // Task 1 (owner-locked, paid = DELIVERED): RedX `paid` is BOTH a
    // delivery event AND a money event. It advances the delivery workflow
    // (DELIVERED + Delivered, same as pathao/carrybee order.paid) AND keeps
    // the money recording (invoice_number on the timeline + WebhookAttempt
    // meta via the controller). paid→money-only is DEAD/withdrawn.
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
   * Task 1 (owner-locked, paid = DELIVERED): RedX `paid` delivery + money.
   * Advances the delivery workflow (Dispatch DELIVERED + order Delivered,
   * same as pathao/carrybee order.paid) AND keeps the money recording: the
   * merchant invoice_number rides the timeline entry + the WebhookAttempt
   * row via the controller meta (existing pattern, no new table). A definite
   * amount rides the timeline ONLY when the payload carries one (numeric
   * collected_amount/amount/cash_collected/cash_paid); otherwise identifiers
   * only. Books NO Payment row — the CSV settlement owns the money
   * (paid + CSV → single payment via the settlement transactionId dedupe).
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

    await this.fillManualDispatchIdentifiers(orderId, 'redx', consignmentId);
    await this.upsertDispatch(orderId, 'redx', consignmentId, 'DELIVERED', body, 'paid');

    const extra: Record<string, unknown> = {
      invoice_number: invoiceNumber,
      remarks: body['message_en'] as string | undefined,
    };
    const definiteAmount = this.definitePaidAmount(body);
    if (definiteAmount != null) extra.collected_amount = definiteAmount;
    await this.addTimelineEntry(orderId, 'redx', 'DELIVERED', extra);

    const orderStatusName = REDX_DISPATCH_TO_ORDER['DELIVERED'];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(orderId, orderStatusName);
    }

    this.logger.log(
      `RedX PAID: parcel ${consignmentId} paid (invoice ${invoiceNumber || 'unknown'}) — ` +
        `dispatch=DELIVERED order=${orderStatusName || '-'} recorded for settlement`,
    );
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  /**
   * Task 1: definite-amount gate for paid money recording. Returns the
   * numeric amount ONLY when the payload carries an explicit finite number
   * (or numeric string); otherwise null (identifiers only — never infer
   * from the order total). Checked keys cover the known paid vocabularies:
   * collected_amount (pathao/carrybee), amount, cash_collected/cash_paid
   * (redx settlement vocabulary).
   */
  private definitePaidAmount(body: Record<string, unknown>): number | null {
    for (const key of ['collected_amount', 'amount', 'cash_collected', 'cash_paid']) {
      const raw = body[key];
      if (raw == null || raw === '') continue;
      const num = Number(raw);
      if (Number.isFinite(num)) return num;
    }
    return null;
  }

  async handleCarrybee(body: Record<string, unknown>) {
    const event = body['event'] as string;

    if (event === 'webhook_integration') {
      this.logger.log('Carrybee webhook integration test received');
      return { status: 'success', message: 'Webhook integration successful' };
    }

    // Task A (extra f): order.create-failed carries NO consignment_id (doc
    // shape: merchant_order_id + reason + causes) — branch BEFORE the
    // parcel-key requirement. Never fabricate a dispatch for a failed
    // creation; CANCELLED marks only the optimistic record, if one exists.
    if (event === 'order.create-failed') {
      return this.handleCreateFailed(body);
    }

    const consignmentId = body['consignment_id'] as string;
    if (!consignmentId) {
      this.logger.warn('Carrybee webhook missing consignment_id');
      throw new BadRequestException('Missing consignment_id');
    }

    const order = await this.findCarrybeeOrder(
      consignmentId,
      (body['merchant_order_id'] as string) || undefined,
    );
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

    // Task 7 (owner-locked): failed delivery/pickup attempts are NOT
    // cancellations — record attempt+reason+remarks + timeline, change NO
    // state (no dispatch status write, no order advancement). CANCELLED /
    // RETURNED happen only on explicit events (order.pickup-cancelled,
    // order.returned*, …).
    if (event === 'order.pickup-failed' || event === 'order.delivery-failed') {
      return this.recordCarrybeeAttemptOnly(order.id, consignmentId, event, body);
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
    // Task 1 (owner-locked, paid = DELIVERED + money): Carrybee mirrors the
    // Pathao order.* vocabulary — order.paid carries the settlement money
    // identifiers (invoice_id + payment_status; collected_amount above is
    // recorded only when definite). They ride the timeline entry
    // (→ invoiceNumber, no new table) + the WebhookAttempt meta via the
    // controller. Doc read: Carrybee v2 details shape
    // (carrybee-v2.spec: invoice_id + payment_status + collected_amount) +
    // carrybee invoice CSV Invoice_number column; no live keys used.
    if (body['invoice_id'] != null && body['invoice_id'] !== '') extra.invoice_number = body['invoice_id'];
    else if (body['invoice_number'] != null && body['invoice_number'] !== '') extra.invoice_number = body['invoice_number'];
    if (body['payment_status'] != null && body['payment_status'] !== '') extra.payment_status = body['payment_status'];
    await this.addTimelineEntry(order.id, 'carrybee', dispatchStatus, extra);

    const orderStatusName = CARRYBEE_DISPATCH_TO_ORDER[dispatchStatus];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(order.id, orderStatusName);
    }

    this.logger.log(`Carrybee: ${consignmentId} → dispatch=${dispatchStatus} order=${orderStatusName || '-'}`);
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  /**
   * Task A (extra f, owner-locked): Carrybee `order.create-failed` — the
   * courier refused to create the order (doc: merchant_order_id + reason +
   * 422 `causes`, no consignment_id). Record raw + timeline + loud alert;
   * create NO dispatch row. CANCELLED marks ONLY a pre-existing optimistic
   * record (a dispatch row created before the courier booking existed).
   */
  private async handleCreateFailed(body: Record<string, unknown>) {
    const merchantOrderId = String(body['merchant_order_id'] ?? '').trim();
    if (!merchantOrderId) {
      this.logger.warn('Carrybee create-failed missing merchant_order_id');
      throw new BadRequestException('Missing merchant_order_id');
    }

    const cutId = normalizeInvoiceForCompare(merchantOrderId);
    const order = await this.prisma.order.findFirst({
      where: {
        displayId: cutId,
        courierService: 'carrybee',
        trashedAt: null,
      },
    });
    if (!order) {
      this.logger.warn(
        `Carrybee create-failed UNMATCHED — no order for merchant_order_id ${merchantOrderId} (courier=carrybee). Leaving identifiers blank; create the dispatch from admin or stamp the Order row.`,
      );
      throw new NotFoundException(`Order not found for merchant_order_id ${merchantOrderId}`);
    }

    await this.prisma.order.update({
      where: { id: (order as any).id },
      data: { courierStatus: 'order.create-failed', courierService: 'carrybee' },
    });

    const optimistic = await this.prisma.dispatch.findFirst({
      where: { orderId: (order as any).id, courier: 'carrybee' as any },
      orderBy: { createdAt: 'asc' },
    });
    if (optimistic) {
      await this.prisma.dispatch.update({
        where: { id: (optimistic as any).id },
        data: {
          status: 'CANCELLED',
          courierStatus: 'order.create-failed',
          lastSyncedAt: new Date(),
        },
      });
    }

    const reason = String(body['reason'] || 'unknown reason');
    const causes =
      body['causes'] != null ? ` — causes: ${JSON.stringify(body['causes'])}` : '';
    await this.addTimelineEntry((order as any).id, 'carrybee', 'order.create-failed', {
      reason: body['reason'],
      remarks:
        `Create failed: ${reason}${causes} — ` +
        (optimistic ? 'optimistic dispatch marked CANCELLED' : 'no dispatch created'),
    });

    this.logger.error(
      `Carrybee create-failed: merchant order ${merchantOrderId} (order ${(order as any).id}) — ` +
        `${reason}${causes}; ${optimistic ? 'optimistic dispatch CANCELLED' : 'no dispatch record'}`,
    );
    return { status: 'success', message: 'Create failure recorded' };
  }

  /**
   * Task 7 (owner-locked): record-only path for failed Carrybee attempts.
   * Mirrors the Pathao skip-status pattern: persist the raw courier state on
   * the order + existing dispatch row (courierStatus only, never the workflow
   * `status`) and a timeline entry carrying attempt/reason/remarks — but
   * NEVER force a workflow change (no CANCELLED, no RETURN_PENDING).
   */
  private async recordCarrybeeAttemptOnly(
    orderId: string,
    consignmentId: string,
    event: string,
    body: Record<string, unknown>,
  ) {
    this.logger.log(
      `Carrybee: ${consignmentId} event "${event}" → recorded, workflow unchanged (failed attempts never cancel)`,
    );
    await this.prisma.order.update({
      where: { id: orderId },
      data: { courierStatus: event, courierService: 'carrybee' },
    });

    const existing = await this.prisma.dispatch.findFirst({
      where: { courier: 'carrybee' as any, consignmentId },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.dispatch.update({
        where: { id: existing.id },
        data: { courierStatus: event, lastSyncedAt: new Date() },
      });
    } else {
      await this.fillManualDispatchIdentifiers(orderId, 'carrybee', consignmentId);
    }

    const extra: Record<string, unknown> = {};
    if (body['reason']) extra.reason = body['reason'];
    if (body['collected_amount'] != null) extra.collected_amount = body['collected_amount'];
    if (body['remarks']) extra.remarks = body['remarks'];
    if (body['attempt'] != null) extra.attempt = body['attempt'];
    if (body['agent_name']) extra.agent_name = body['agent_name'];
    if (body['agent_phone']) extra.agent_phone = body['agent_phone'];
    await this.addTimelineEntry(orderId, 'carrybee', event, extra);
    return { status: 'success', message: 'Delivery attempt recorded — no status change' };
  }

  /**
   * Resolve the order for a Carrybee webhook by consignment id:
   * 1. Order.courierConsignmentId — automated API dispatch.
   * 2. Dispatch registry — staff pre-created rows carrying identifiers whose
   *    order claim was skipped (claimed by a different consignment).
   * 3. merchant_order_id — the documented webhook identifier; the v2 API
   *    dispatch flow sends Order.displayId as merchant_order_id (portal
   *    bookings resolve this way too).
   * Portal bookings with neither stay unmatchable by design (loud warn above).
   */
  private async findCarrybeeOrder(
    consignmentId: string,
    merchantOrderId?: string,
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

    if (merchantOrderId) {
      // Task 10: tolerate server-cut text (cut form documented in
      // courier-settle-guard.normalizeInvoiceForCompare).
      const cutId = normalizeInvoiceForCompare(merchantOrderId);
      const viaMerchantId = await this.prisma.order.findFirst({
        where: {
          displayId: cutId,
          courierService: 'carrybee',
          trashedAt: null,
        },
      });
      if (viaMerchantId) return viaMerchantId;
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
