import { DispatchStatus } from '@prisma/client';
import { isUnsettledCourierStatus } from './courier-settle-guard';

/**
 * Maps the courier's own running/current status (as returned by the courier
 * tracking APIs via CourierTrackingService, or by webhook-mapped labels) onto
 * our internal DispatchStatus workflow status.
 *
 * This is the sync-side pendant of the webhook status maps in
 * courier-webhook.service.ts: manual "Sync Status from Courier" reconciles a
 * dispatch exactly like a (possibly missed) webhook would, so the vocabularies
 * here intentionally include both the tracking-API labels and the webhook
 * event labels. Unknown statuses return null — the raw status is still
 * persisted, but no Dispatch status change is forced (webhook "skip" parity).
 *
 * Dispatch status (``Dispatch.status``) and courier status (raw string on
 * ``Dispatch.courierStatus`` / ``Order.courierStatus``) are two separate
 * concepts and are never conflated here.
 */

export const SUPPORTED_COURIERS = ['steadfast', 'pathao', 'redx', 'carrybee'];

export function isSupportedCourier(courier: string): boolean {
  return SUPPORTED_COURIERS.includes(courier);
}

const COURIER_TRACKING_STATUS_MAP: Record<
  string,
  Record<string, DispatchStatus | null>
> = {
  // Steadfast: normalized values produced by CourierTrackingService's
  // STEADFAST_STATUS_MAP (tracking API vocabulary) — kept in sync with the
  // Steadfast webhook map in courier-webhook.service.ts and the official
  // API docs (packzy.com/api/v1, "Checking Delivery Status"): pending,
  // delivered_approval_pending, partial_delivered_approval_pending,
  // cancelled_approval_pending, unknown_approval_pending, delivered,
  // partial_delivered, cancelled, hold, in_review, unknown.
  steadfast: {
    pending: 'PICKED_UP',
    picked_up: 'PICKED_UP',
    in_transit: 'IN_TRANSIT',
    in_review: 'DISPATCHED',
    delivered: 'DELIVERED',
    'delivered_approval_pending': 'ASSIGNED_TO_RIDER',
    partial: 'PARTIAL',
    'partial_delivered_approval_pending': 'PARTIAL',
    cancelled: 'CANCELLED',
    'cancelled_approval_pending': 'ASSIGNED_TO_RIDER',
    return_pending: 'RETURN_PENDING',
    // Sheet Rule 25: a courier signal never moves dispatch to RETURNED — that
    // is a staff-confirmed physical receive. A back-with-merchant tracking
    // label stays at RETURN_PENDING (max).
    returned: 'RETURN_PENDING',
    hold: 'HOLD',
    // Task 5 (owner-locked): `exceptional` = lost, damaged or otherwise off
    // the normal path. There is NO EXCEPTION value in the DispatchStatus
    // enum (schema.prisma), so this yields null — keep the previous status,
    // never HOLD/DELIVERED/settle. The webhook raises the staff alert.
    exceptional: null,
  // Task 5 (owner-locked): return-endpoint vocabulary — ONLY sourced from
  // GET /status_with_return_status_by_cid (Steadfast webhooks never carry
  // these; see SteadFast Webhooks Docs delivery_status list). Spellings are
  // doc-literal ("proccessing"); the corrected spelling is accepted too.
  // cancelled_* ride the RETURNED/CANCELLED path (in-flight → RETURN_PENDING,
  // back-with-us → RETURNED). Task 6 (Fix 13, rows 39–40): partial
  // in-progress labels ride RETURN_PENDING in this map too (parcel on its way
  // back); only partial_delivered_return_received keeps PARTIAL. The ORDER
  // outcome for partial rows stays 'Partial' (STEADFAST_RETURN_MAP below) —
  // never Delivered.
    'cancelled_return_proccessing': 'RETURN_PENDING',
    'cancelled_return_processing': 'RETURN_PENDING',
    'cancelled_return_rider_assigned': 'RETURN_PENDING',
    // Task 6 (Fix 13, rows 39–40 owner-locked): partial in-progress return
    // labels ride RETURN_PENDING (the parcel is on its way back — no longer a
    // plain PARTIAL hold). The ORDER keeps its Partial outcome (never
    // Delivered) via STEADFAST_RETURN_MAP.advanceOrder below.
    // Sheet Rule 2 / 25: "courier delivered the return to us" is at most
    // RETURN_PENDING — RETURNED only after staff physically receive it.
    'cancelled_return_received': 'RETURN_PENDING',
    'partial_delivered_return_proccessing': 'RETURN_PENDING',
    'partial_delivered_return_processing': 'RETURN_PENDING',
    'partial_delivered_return_rider_assigned': 'RETURN_PENDING',
    'partial_delivered_return_received': 'PARTIAL',
    // Task A (owner-locked): "unknown" is NOT a cancellation — the courier
    // explicitly reports it cannot determine the state. Yield null (keep the
    // previous status, never CANCELLED) and let the webhook raise the
    // staff alert with the raw state + timeline.
    unknown: null,
    // Unknown awaiting admin approval — needs support; never force a status.
    'unknown_approval_pending': null,
  },
  // Pathao tracking API may surface either the webhook event vocabulary
  // ("order.*") or plain status keywords; both are covered — exact labels
  // first, keyword fallback below. Statuses the webhooks explicitly skip
  // (mapped to null there) must also map to null here, never to a keyword.
  pathao: {
    'order.created': 'DISPATCHED',
    'order.updated': null,
    'order.pickup-requested': null,
    'order.assigned-for-pickup': null,
    // Task 3 (owner-locked F7): pickup-failed is a real PICKUP_FAILED
    // workflow state (record attempt + reason + alert) — never the skip
    // path. Owner ruling 2026-10-30: it never moves the ORDER status.
    // delivery-failed stays record-only (null).
    'order.pickup-failed': 'PICKUP_FAILED',
    'order.picked': 'PICKED_UP',
    'order.at-the-sorting-hub': 'IN_TRANSIT',
    'order.in-transit': 'IN_TRANSIT',
    // Task 3 (owner-locked F7): last-mile-hub is its own ASSIGNED_TO_HUB
    // state — ASSIGNED_TO_RIDER is ONLY for assigned-for-delivery.
    'order.received-at-last-mile-hub': 'ASSIGNED_TO_HUB',
    'order.assigned-for-delivery': 'ASSIGNED_TO_RIDER',
    'order.delivery-failed': null,
    'order.delivered': 'DELIVERED',
    'order.partial-delivery': 'PARTIAL',
    'order.on-hold': 'HOLD',
    'order.returned': 'RETURN_PENDING',
    'order.return-id-created': 'RETURN_PENDING',
    'order.return-in-transit': 'RETURN_PENDING',
    // Sheet Rule 25: back-with-merchant stays RETURN_PENDING (max); RETURNED
    // only when staff marks the Return received.
    'order.returned-to-merchant': 'RETURN_PENDING',
    'order.paid-return': 'RETURN_PENDING',
    'order.paid': 'DELIVERED',
    // Task 1 (owner-locked, paid = DELIVERED): plain tracking-API `paid`
    // label → DELIVERED (webhook `order.paid` above already does).
    'paid': 'DELIVERED',
    'order.exchanged': 'DELIVERED',
    'order.pickup-cancelled': 'CANCELLED',
    // Plain labels from the official /orders/{id}/info endpoint
    // ("Order Status" vocabulary of the Pathao Merchant API): the tracking
    // API returns these instead of the webhook event names. Exact-match
    // entries are evaluated against the lowercased raw status, so the
    // title-case labels are listed lowercase.
    'pickup requested': null,
    'assigned for pickup': null,
    // 'assigned for delivery' → ASSIGNED_TO_RIDER, NOT the `deliver` keyword.
    'assigned for delivery': 'ASSIGNED_TO_RIDER',
    // Task 3 (owner-locked F7): 'pickup failed' is the PICKUP_FAILED state
    // (mirrors 'order.pickup-failed'); 'delivery failed' stays record-only.
    // The generic /fail|error/ guard below covers any other failure label.
    'pickup failed': 'PICKUP_FAILED',
    'pickup-failed': 'PICKUP_FAILED',
    'delivery failed': null,
    'payment invoice': null,
    'at the sorting hub': 'IN_TRANSIT',
    'in transit': 'IN_TRANSIT',
    // Task 3 (owner-locked F7): hub state, NOT the rider state.
    'received at last mile hub': 'ASSIGNED_TO_HUB',
    'partial delivery': 'PARTIAL',
    'on hold': 'HOLD',
    delivered: 'DELIVERED',
    // 'return' → return flow start; returned → RETURNED via keyword fallback.
    return: 'RETURN_PENDING',
    'paid return': 'RETURN_PENDING',
    exchange: 'DELIVERED',
    exchanged: 'DELIVERED',
    // Task 10 (owner-locked): approval_pending NEVER settles — anything
    // ending `_approval_pending` is the rider's word, not ours. The previous
    // DELIVERED mapping violated the lock (a money-affecting promotion on an
    // unconfirmed label); null keeps the workflow unchanged, never settles.
    exchanged_approval_pending: null,
    pickup: 'PICKED_UP',
    picked: 'PICKED_UP',
    pending: 'DISPATCHED',
  },
  // RedX: tracking API and webhook share the same status vocabulary.
  redx: {
    // Task 5 (owner-locked): `pickup-pending` = just booked, awaiting pickup
    // (the /parcel/info answer for a fresh parcel) = internal DISPATCHED —
    // verified: Dispatch.status defaults to DISPATCHED at booking, and
    // order.created → DISPATCHED for Pathao/Carrybee. Underscore variant
    // accepted (same tolerance as the rest of this map).
    'pickup-pending': 'DISPATCHED',
    pickup_pending: 'DISPATCHED',
    // Task A (owner-locked): `ready-for-delivery` = parcel received from the
    // merchant, rider not yet assigned (RedX doc: "Parcel received from
    // merchants" vs `delivery-in-progress`: "dispatched to rider"). The
    // previous PICKED_UP mapping overstated possession; ASSIGNED_TO_RIDER
    // keeps the order at Shipping without claiming a pickup.
    'ready-for-delivery': 'ASSIGNED_TO_RIDER',
    'delivery-in-progress': 'ASSIGNED_TO_RIDER',
    delivered: 'DELIVERED',
    'agent-hold': 'HOLD',
    'agent-returning': 'RETURN_PENDING',
    returned: 'RETURN_PENDING',
    // Task 1 (owner-locked, paid = DELIVERED): RedX `paid` is a delivery
    // event AND a money event — DELIVERED here (webhook keeps the money
    // recording on the timeline + WebhookAttempt meta).
    'paid': 'DELIVERED',
  },
  carrybee: {
    'order.created': 'DISPATCHED',
    'order.updated': null,
    'order.pickup-requested': null,
    'order.assigned-for-pickup': null,
    // Task 3 (owner-locked F7): pickup-failed → PICKUP_FAILED (same as
    // Pathao); delivery-failed stays record-only (null).
    'order.pickup-failed': 'PICKUP_FAILED',
    'order.picked': 'PICKED_UP',
    'order.at-the-sorting-hub': 'IN_TRANSIT',
    'order.on-the-way-to-central-warehouse': 'IN_TRANSIT',
    'order.at-central-warehouse': 'IN_TRANSIT',
    'order.in-transit': 'IN_TRANSIT',
    // Task 3 (owner-locked F7): hub state — ASSIGNED_TO_RIDER is ONLY for
    // assigned-for-delivery.
    'order.received-at-last-mile-hub': 'ASSIGNED_TO_HUB',
    'order.assigned-for-delivery': 'ASSIGNED_TO_RIDER',
    'order.delivery-on-hold': 'HOLD',
    'order.delivery-failed': null,
    'order.delivered': 'DELIVERED',
    'order.partial-delivery': 'PARTIAL',
    'order.returned': 'RETURN_PENDING',
    'order.returned-at-sorting': 'RETURN_PENDING',
    'order.returned-in-transit': 'RETURN_PENDING',
    // Sheet Rule 25: never RETURNED on a courier signal.
    'order.returned-to-merchant': 'RETURN_PENDING',
    'order.paid-return': 'RETURN_PENDING',
    'order.exchange': 'DELIVERED',
    'order.paid': 'DELIVERED',
    // Task 1 (owner-locked, paid = DELIVERED): plain tracking-API `paid`
    // label → DELIVERED (webhook `order.paid` above already does).
    'paid': 'DELIVERED',
    'order.create-failed': 'CANCELLED',
    'order.pickup-cancelled': 'CANCELLED',
    // Task 3 (owner-locked F7): plain tracking-API failure labels (Pathao
    // vocabulary mirror) — pickup-failed is the PICKUP_FAILED state;
    // delivery-failed stays record-only via the /fail|error/ guard below.
    'pickup-failed': 'PICKUP_FAILED',
    'pickup failed': 'PICKUP_FAILED',
  },
};

/**
 * Keyword fallback for courier labels not covered by the exact maps above.
 * Ordering matters: more specific keywords must be tested first
 * ("partial" before "deliver", "returned" before "return").
 *
 * Any "failed/error" label NOT in the exact maps above is deliberately
 * excluded before fallback: the webhooks map delivery failures to null
 * (skip), and a failed consignment must never be promoted to
 * DELIVERED/PICKED_UP. (Task 3 owner-locked exception: exact-mapped
 * pickup-failed → PICKUP_FAILED returns from the exact map above, before
 * this guard runs.)
 */
const KEYWORD_RULES: Array<{ match: RegExp; status: DispatchStatus }> = [
  { match: /partial/i, status: 'PARTIAL' },
  { match: /deliver/i, status: 'DELIVERED' },
  // Sheet Rule 25: no courier label may yield RETURNED — back-with-merchant
  // is still RETURN_PENDING (max); only staff receipt sets RETURNED.
  { match: /return/i, status: 'RETURN_PENDING' },
  { match: /cancel/i, status: 'CANCELLED' },
  { match: /hold/i, status: 'HOLD' },
  { match: /pickup|picked/i, status: 'PICKED_UP' },
  { match: /transit|hub|warehouse|shipp/i, status: 'IN_TRANSIT' },
  { match: /rider|delivery|assign/i, status: 'ASSIGNED_TO_RIDER' },
  { match: /pending|review/i, status: 'DISPATCHED' },
];

export function mapCourierStatusToDispatchStatus(  courier: string,
  rawStatus: string | null | undefined,
): DispatchStatus | null {
  const normalized = String(rawStatus || '').trim().toLowerCase();
  if (!normalized) return null;

  const courierMap = COURIER_TRACKING_STATUS_MAP[courier];
  if (courierMap && normalized in courierMap) {
    return courierMap[normalized] ?? null;
  }

  // Webhook parity: delivery/pickup failures are "skip" statuses. Tracking
  // APIs sometimes surface plain "delivery-failed"/"failed" labels instead of
  // the "order.*" event vocabulary — these must never match `deliver`.
  if (/fail|error/i.test(normalized)) return null;

  // Task 10 (owner-locked): any *_approval_pending label NOT in the exact map
  // above is the rider's word, not ours — never settle via keyword fallback
  // (`deliver`/`pending` keywords would otherwise promote it to DELIVERED or
  // DISPATCHED). Exact-map entries (e.g. steadfast partial_delivered_approval
  // _pending → PARTIAL, T5-locked) already returned above and are unaffected.
  if (isUnsettledCourierStatus(normalized)) return null;

  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(normalized)) return rule.status;
  }

  return null;
}

/**
 * Task 5 (owner-locked): Steadfast return-status reconciliation.
 *
 * The 6 return statuses exist ONLY in the
 * GET /status_with_return_status_by_cid/{id} vocabulary (doc: "Only from
 * /status_with_return_status_by_cid/{id}, and only for a parcel that did not
 * fully arrive"). cancelled_* ride the RETURNED/CANCELLED path; partial
 * in-progress labels ride dispatch RETURN_PENDING with a Partial order outcome
 * (Task 6, Fix 13 rows 39–40); only partial_delivered_return_received keeps
 * dispatch PARTIAL. *_received means the parcel is physically
 * back ("you have it back") → reconcile stock via the item-level return path,
 * and NO COD is owed (a returned parcel collects nothing).
 *
 * `codOwed` is always false by construction — the settle-exclusion lock:
 * no return status may ever settle. Non-return input yields null (the normal
 * tracking/webhook sync owns those labels).
 */
export interface SteadfastReturnMapping {
  dispatchStatus: DispatchStatus;
  /** Order advancement the reconcile may attempt (null = dispatch-level only;
   * 'Returned' is manual-confirmation-only, never set here). */
  advanceOrder: string | null;
  /** True only for *_received (parcel physically back with the merchant). */
  reconcileStock: boolean;
  /** Always false — no return status ever settles. */
  codOwed: false;
}

const STEADFAST_RETURN_MAP: Record<string, SteadfastReturnMapping> = {
  'cancelled_return_proccessing': { dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Return Pending', reconcileStock: false, codOwed: false },
  'cancelled_return_processing': { dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Return Pending', reconcileStock: false, codOwed: false },
  'cancelled_return_rider_assigned': { dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Return Pending', reconcileStock: false, codOwed: false },
  // Sheet Rule 2 / 25 (conformance 2026-10-23): the courier delivered the
  // return to us — dispatch stays RETURN_PENDING (RETURNED is staff-only) and
  // the order surfaces as 'Return Pending' for staff confirmation. The Return
  // record's stage moves to DELIVERED; stock reconciles only on staff receive.
  'cancelled_return_received': { dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Return Pending', reconcileStock: true, codOwed: false },
  // Task 6 (Fix 13, rows 39–40 owner-locked): partial in-progress labels ride
  // dispatch RETURN_PENDING (parcel on its way back) while the ORDER keeps its
  // Partial outcome — never Delivered.
  'partial_delivered_return_proccessing': { dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Partial', reconcileStock: false, codOwed: false },
  'partial_delivered_return_processing': { dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Partial', reconcileStock: false, codOwed: false },
  'partial_delivered_return_rider_assigned': { dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Partial', reconcileStock: false, codOwed: false },
  // T6 gap fix (owner-locked): reconcileStock:true here is the INTENT flag
  // (parcel physically back with the merchant). The reconcile path does NOT
  // blanket-restore partials — it runs restore-or-hold via the open
  // staff-Return lookup (items-known → RESTOCKED, unknown → HOLD + loud
  // "confirm items to restock" alert). Timeline + log derive from the ACTUAL
  // result, never from this flag alone.
  'partial_delivered_return_received': { dispatchStatus: 'PARTIAL', advanceOrder: 'Partial', reconcileStock: true, codOwed: false },
};

export function mapSteadfastReturnStatus(
  rawStatus: string | null | undefined,
): SteadfastReturnMapping | null {
  const normalized = String(rawStatus || '').trim().toLowerCase();
  if (!normalized) return null;
  return STEADFAST_RETURN_MAP[normalized] ?? null;
}

// ---------------------------------------------------------------------------
// Return auto-create policy (sheet Rule 27 + Return Creation tab)
// ---------------------------------------------------------------------------

/**
 * A courier label that indicates a return, and what it means for the unified
 * Return record:
 * - stage IN_PROGRESS → Return stage 'in-progress' (dispatch RETURN_PENDING).
 * - stage DELIVERED   → courier delivered the return TO US; Return stage
 *   'delivered' (NOT received — stock/returned status stay staff-only).
 * - type PARTIAL      → NEVER auto-created (Rule 27b): link-only + hold alert.
 * - createIfMissing   → false for link-only notifications (Steadfast
 *   return_request / return_list_accepted — owner decision 2026-10-23).
 *
 * Both vocabularies are covered: webhook event names (`order.returned`) and
 * plain tracking-API labels (`returned`). Unknown labels return null.
 */
export interface CourierReturnSignal {
  stage: 'IN_PROGRESS' | 'DELIVERED';
  type: 'FULL' | 'PARTIAL';
  createIfMissing: boolean;
}

const RETURN_SIGNAL_IN_PROGRESS: Record<string, readonly string[]> = {
  pathao: [
    'order.return-id-created',
    'order.return-in-transit',
    'order.returned',
    'order.paid-return',
    'return',
    'paid return',
    'return_pending',
    'return pending',
  ],
  carrybee: [
    'order.returned',
    'order.paid-return',
    'order.returned-at-sorting',
    'order.returned-in-transit',
    'return',
    'paid return',
    'return_pending',
  ],
  redx: ['agent-returning'],
  steadfast: [
    'return_pending',
    'returned',
    'cancelled_return_proccessing',
    'cancelled_return_processing',
    'cancelled_return_rider_assigned',
  ],
};

const RETURN_SIGNAL_DELIVERED: Record<string, readonly string[]> = {
  // Courier delivered the return to us (back-with-merchant). RedX has no
  // separate back-with-merchant event — its terminal `returned` state IS the
  // parcel back with the merchant (owner decision 2026-10-23: RedX returns
  // behave exactly like the other couriers — FULL, reaching DELIVERED on the
  // terminal signal; dispatch still caps at RETURN_PENDING per Rule 25).
  pathao: ['order.returned-to-merchant'],
  carrybee: ['order.returned-to-merchant'],
  redx: ['returned'],
  steadfast: ['cancelled_return_received'],
};

const RETURN_SIGNAL_PARTIAL: Record<string, readonly string[]> = {
  // Courier partial-return labels: the courier never reports WHICH items/qty
  // came back → NO auto-create (Rule 27b / Return Creation rows 20–22).
  steadfast: [
    'partial_delivered_return_proccessing',
    'partial_delivered_return_processing',
    'partial_delivered_return_rider_assigned',
    'partial_delivered_return_received',
  ],
};

const RETURN_SIGNAL_LINK_ONLY: Record<string, readonly string[]> = {
  // "link to our return" notifications — never create a Return from these
  // (owner decision 2026-10-23: LINK-only confirmed — a return REQUEST is
  // not a confirmed return).
  steadfast: ['return_request', 'return_list_accepted'],
};

export function mapCourierReturnSignal(
  courier: string,
  rawStatus: string | null | undefined,
): CourierReturnSignal | null {
  const normalized = String(rawStatus || '').trim().toLowerCase();
  if (!normalized) return null;

  if ((RETURN_SIGNAL_DELIVERED[courier] ?? []).includes(normalized)) {
    return { stage: 'DELIVERED', type: 'FULL', createIfMissing: true };
  }
  if ((RETURN_SIGNAL_PARTIAL[courier] ?? []).includes(normalized)) {
    return {
      stage: normalized.endsWith('_received') ? 'DELIVERED' : 'IN_PROGRESS',
      type: 'PARTIAL',
      createIfMissing: false,
    };
  }
  if ((RETURN_SIGNAL_LINK_ONLY[courier] ?? []).includes(normalized)) {
    return { stage: 'IN_PROGRESS', type: 'FULL', createIfMissing: false };
  }
  if ((RETURN_SIGNAL_IN_PROGRESS[courier] ?? []).includes(normalized)) {
    return { stage: 'IN_PROGRESS', type: 'FULL', createIfMissing: true };
  }
  return null;
}