import { DispatchStatus } from '@prisma/client';

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
  // STEADFAST_STATUS_MAP (tracking API vocabulary).
  steadfast: {
    pending: 'PICKED_UP',
    picked_up: 'PICKED_UP',
    in_transit: 'IN_TRANSIT',
    delivered: 'DELIVERED',
    partial: 'PARTIAL',
    cancelled: 'CANCELLED',
    return_pending: 'RETURN_PENDING',
    returned: 'RETURNED',
    hold: 'HOLD',
    // Webhook parity: the Steadfast webhook treats "unknown" as cancelled.
    unknown: 'CANCELLED',
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
    'order.pickup-failed': null,
    'order.picked': 'PICKED_UP',
    'order.at-the-sorting-hub': 'IN_TRANSIT',
    'order.in-transit': 'IN_TRANSIT',
    'order.received-at-last-mile-hub': 'ASSIGNED_TO_RIDER',
    'order.assigned-for-delivery': 'ASSIGNED_TO_RIDER',
    'order.delivery-failed': null,
    'order.delivered': 'DELIVERED',
    'order.partial-delivery': 'PARTIAL',
    'order.on-hold': 'HOLD',
    'order.returned': 'RETURN_PENDING',
    'order.return-id-created': 'RETURN_PENDING',
    'order.return-in-transit': 'RETURN_PENDING',
    'order.returned-to-merchant': 'RETURNED',
    'order.paid-return': 'RETURN_PENDING',
    'order.paid': 'DELIVERED',
    'order.exchanged': 'DELIVERED',
    'order.pickup-cancelled': 'CANCELLED',
  },
  // RedX: tracking API and webhook share the same status vocabulary.
  redx: {
    'ready-for-delivery': 'PICKED_UP',
    'delivery-in-progress': 'ASSIGNED_TO_RIDER',
    delivered: 'DELIVERED',
    'agent-hold': 'HOLD',
    'agent-returning': 'RETURN_PENDING',
    returned: 'RETURN_PENDING',
  },
  carrybee: {
    'order.created': 'DISPATCHED',
    'order.updated': null,
    'order.pickup-requested': null,
    'order.assigned-for-pickup': null,
    'order.pickup-failed': null,
    'order.picked': 'PICKED_UP',
    'order.at-the-sorting-hub': 'IN_TRANSIT',
    'order.on-the-way-to-central-warehouse': 'IN_TRANSIT',
    'order.at-central-warehouse': 'IN_TRANSIT',
    'order.in-transit': 'IN_TRANSIT',
    'order.received-at-last-mile-hub': 'ASSIGNED_TO_RIDER',
    'order.assigned-for-delivery': 'ASSIGNED_TO_RIDER',
    'order.delivery-on-hold': 'HOLD',
    'order.delivery-failed': null,
    'order.delivered': 'DELIVERED',
    'order.partial-delivery': 'PARTIAL',
    'order.returned': 'RETURN_PENDING',
    'order.returned-at-sorting': 'RETURN_PENDING',
    'order.returned-in-transit': 'RETURN_PENDING',
    'order.returned-to-merchant': 'RETURNED',
    'order.paid-return': 'RETURN_PENDING',
    'order.exchange': 'DELIVERED',
    'order.paid': 'DELIVERED',
    'order.create-failed': 'CANCELLED',
    'order.pickup-cancelled': 'CANCELLED',
  },
};

/**
 * Keyword fallback for courier labels not covered by the exact maps above.
 * Ordering matters: more specific keywords must be tested first
 * ("partial" before "deliver", "returned" before "return").
 *
 * Any "failed/error" label is deliberately excluded before fallback: the
 * webhooks map delivery/pickup failures to null (skip), and a failed
 * consignment must never be promoted to DELIVERED/PICKED_UP.
 */
const KEYWORD_RULES: Array<{ match: RegExp; status: DispatchStatus }> = [
  { match: /partial/i, status: 'PARTIAL' },
  { match: /deliver/i, status: 'DELIVERED' },
  { match: /returned/i, status: 'RETURNED' },
  { match: /return/i, status: 'RETURN_PENDING' },
  { match: /cancel/i, status: 'CANCELLED' },
  { match: /hold/i, status: 'HOLD' },
  { match: /pickup|picked/i, status: 'PICKED_UP' },
  { match: /transit|hub|warehouse|shipp/i, status: 'IN_TRANSIT' },
  { match: /rider|delivery|assign/i, status: 'ASSIGNED_TO_RIDER' },
  { match: /pending|review/i, status: 'DISPATCHED' },
];

export function mapCourierStatusToDispatchStatus(
  courier: string,
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

  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(normalized)) return rule.status;
  }

  return null;
}