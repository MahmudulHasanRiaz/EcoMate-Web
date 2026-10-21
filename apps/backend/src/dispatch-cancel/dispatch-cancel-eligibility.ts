import { DispatchStatus } from '@prisma/client';

/**
 * Cancel a DISPATCHED order (owner directive, 2026-10-21).
 *
 * A dispatched order can only be cancelled while the parcel has NOT been
 * picked up / handed over to the courier yet. Everything in this module is
 * PURE (no I/O) so the same rules can be applied:
 *   - server-side, in the cancel endpoint (a crafted request cannot bypass
 *     them), and
 *   - in the admin dialog, to explain the outcome BEFORE the staff confirms.
 *
 * THE AUTHORITY for "picked up" is the courier status mapping: the mapping
 * sheet (courier-status-mapper.ts / the webhook vocabularies) maps every raw
 * courier status onto our internal DispatchStatus. The internal statuses that
 * mean "the parcel is still with us" are PRE_PICKUP_DISPATCH_STATUSES below;
 * everything else means the courier (or a rider) already has the parcel.
 */

/**
 * Internal dispatch statuses where the parcel has NOT been picked up /
 * handed over yet — the booking can still be cancelled with the courier.
 *
 * - DISPATCHED: booked, not collected yet.
 * - PICKUP_FAILED: the courier tried and failed to collect ⇒ the parcel is
 *   STILL with us (staff may also retry the same dispatch).
 */
export const PRE_PICKUP_DISPATCH_STATUSES: readonly DispatchStatus[] = [
  'DISPATCHED',
  'PICKUP_FAILED',
];

/**
 * Internal statuses that are past the point of no return: the courier or a
 * rider already has the parcel, so the booking can no longer be cancelled.
 */
export const POST_PICKUP_DISPATCH_STATUSES: readonly DispatchStatus[] = [
  'HANDED_OVER',
  'PICKED_UP',
  'IN_TRANSIT',
  'ASSIGNED_TO_RIDER',
  'ASSIGNED_TO_HUB',
  'HOLD',
  'DELIVERED',
  'PARTIAL',
  'RETURN_PENDING',
  'RETURNED',
];

/** A dispatch that is done — it never takes part in a cancel. */
export const CLOSED_DISPATCH_STATUSES: readonly DispatchStatus[] = [
  'CANCELLED',
];

/**
 * Per-courier cancel capability — what happens to the courier booking when a
 * dispatched order is cancelled.
 *
 * - Carrybee: API — CourierManagerService.cancelCarrybeeOrder()
 *   (POST /api/v2/orders/{id}/cancel).
 * - RedX: API — CourierManagerService.cancelRedxParcel()
 *   (PATCH /parcels → status = cancelled).
 * - Pathao: API — CourierManagerService.cancelPathaoOrder()
 *   (POST /aladdin/api/v1/orders/{consignment_id}/cancel). Pathao's merchant
 *   API cancels the order/pickup BEFORE collection; our pre-pickup gate below
 *   is the authority for "before collection", and any Pathao refusal after
 *   that (e.g. the parcel is already moving) aborts the whole flow untouched.
 * - Steadfast: NO cancel API in its public merchant API. The combined cancel
 *   still PROCEEDS as a MANUAL fallback: the dispatch is cancelled in EcoMate
 *   only, and staff must cancel the booking in the Steadfast panel. The
 *   pending marker stays on the dispatch until they confirm it here.
 */
export type CourierCancelCapability = {
  /** Can we push the cancel to the courier ourselves? */
  canCancel: boolean;
  /** Which wrapped client method does it. */
  method?: 'carrybee' | 'redx' | 'pathao';
  /** No API, but the local cancel may proceed with a panel follow-up. */
  manualFallback?: boolean;
  /** Shown when the cancel is BLOCKED (no safe path at all). */
  panelGuidance?: string;
  /** Shown when a MANUAL fallback cancel is about to proceed. */
  manualWarning?: string;
};

export const COURIER_CANCEL_CAPABILITY: Record<string, CourierCancelCapability> =
  {
    carrybee: { canCancel: true, method: 'carrybee' },
    redx: { canCancel: true, method: 'redx' },
    pathao: { canCancel: true, method: 'pathao' },
    steadfast: {
      canCancel: false,
      manualFallback: true,
      manualWarning:
        'This booking cannot be cancelled from here. Cancelling will mark the dispatch cancelled in EcoMate; you MUST also cancel the booking in the Steadfast panel.',
    },
  };

/** Display names for the couriers (the UI + the messages). */
export const COURIER_LABELS: Record<string, string> = {
  pathao: 'Pathao',
  steadfast: 'Steadfast',
  redx: 'RedX',
  carrybee: 'Carrybee',
};

export function courierLabel(courier: string): string {
  return COURIER_LABELS[courier] ?? courier;
}

/** The dispatch shape the evaluation needs (a subset of the model). */
export type DispatchCancelSubject = {
  courier: string;
  status: DispatchStatus | string;
  pickedUpAt?: Date | null;
  handedOverAt?: Date | null;
  deliveredAt?: Date | null;
  courierStatus?: string | null;
  courierStatusAt?: Date | null;
};

export type DispatchCancelEvaluation = {
  /** Can this dispatch take part in the combined cancel? */
  eligible: boolean;
  /** Why not (null when eligible) — shown to staff. */
  reason: string | null;
  /** The internal status that blocks it (null when eligible). */
  blockingStatus: DispatchStatus | null;
  /** True when the courier panel needs attention (blocked OR manual). */
  needsCourierPanel: boolean;
  /** True when the cancel proceeds LOCALLY and staff owes a panel cancel. */
  manualPanelCancel: boolean;
  /** The manual-fallback warning (null unless manualPanelCancel). */
  warning: string | null;
  /** When the parcel left our hands (best available evidence). */
  collectedAt: Date | null;
};

/**
 * The single source of truth for "may this dispatch take part in a cancel?".
 *
 * Order of the checks:
 *  1. the parcel already left (internal status past DISPATCHED/PICKUP_FAILED
 *     OR a picked-up/handover/delivered timestamp) ⇒ blocked;
 *  2. a courier cancel API exists ⇒ eligible, pushed via the API;
 *  3. no API but a MANUAL fallback is allowed (Steadfast) ⇒ eligible, the
 *     local cancel proceeds and the panel cancellation stays pending;
 *  4. otherwise ⇒ blocked with the panel guidance (fail closed).
 */
export function evaluateDispatchCancelEligibility(
  dispatch: DispatchCancelSubject,
): DispatchCancelEvaluation {
  const courier = dispatch.courier;
  const label = courierLabel(courier);
  const capability = COURIER_CANCEL_CAPABILITY[courier] ?? {
    canCancel: false,
    panelGuidance: `${label} bookings cannot be cancelled from here — cancel the booking in the ${label} panel first, then cancel the order.`,
  };

  const status = String(dispatch.status) as DispatchStatus;
  const isPrePickup = PRE_PICKUP_DISPATCH_STATUSES.includes(status);
  const collectedAt =
    dispatch.pickedUpAt ??
    dispatch.handedOverAt ??
    dispatch.deliveredAt ??
    dispatch.courierStatusAt ??
    null;

  // 1) the parcel is already with the courier → too late, whatever the
  //    courier's cancel API supports.
  if (!isPrePickup || dispatch.pickedUpAt || dispatch.handedOverAt || dispatch.deliveredAt) {
    const when = collectedAt ? ` on ${formatCollectedAt(collectedAt)}` : '';
    return {
      eligible: false,
      reason: `Parcel already picked up by ${label}${when} — a dispatched order can no longer be cancelled once the courier has the parcel.`,
      blockingStatus: status,
      needsCourierPanel: false,
      manualPanelCancel: false,
      warning: null,
      collectedAt,
    };
  }

  // 2) the courier can cancel the booking for us.
  if (capability.canCancel) {
    return {
      eligible: true,
      reason: null,
      blockingStatus: null,
      needsCourierPanel: false,
      manualPanelCancel: false,
      warning: null,
      collectedAt: null,
    };
  }

  // 3) no API: the local cancel proceeds, the courier panel cancel is owed.
  if (capability.manualFallback) {
    return {
      eligible: true,
      reason: null,
      blockingStatus: null,
      needsCourierPanel: true,
      manualPanelCancel: true,
      warning:
        capability.manualWarning ??
        `This booking cannot be cancelled from here. Cancelling will mark the dispatch cancelled in EcoMate; you MUST also cancel the booking in the ${label} panel.`,
      collectedAt: null,
    };
  }

  // 4) no safe path (unknown courier) ⇒ fail closed.
  return {
    eligible: false,
    reason: capability.panelGuidance!,
    blockingStatus: null,
    needsCourierPanel: true,
    manualPanelCancel: false,
    warning: null,
    collectedAt: null,
  };
}

/**
 * The visible "Panel cancellation pending" marker: a MANUAL-mode cancel with
 * a real courier booking reference that staff have not confirmed yet.
 */
export function isPanelCancelPending(dispatch: {
  status?: string | null;
  courierCancelMode?: string | null;
  courierCancelRef?: string | null;
  panelCancelConfirmedAt?: Date | string | null;
}): boolean {
  return (
    String(dispatch.status) === 'CANCELLED' &&
    dispatch.courierCancelMode === 'MANUAL' &&
    !!dispatch.courierCancelRef &&
    !dispatch.panelCancelConfirmedAt
  );
}

/** "21 Oct 2026, 10:30" (en-GB, like the rest of the admin). */
export function formatCollectedAt(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The raw courier statuses that map onto a PRE-PICKUP internal status — the
 * per-courier "eligible" sheet (derived from the mapping sheet:
 * courier-status-mapper.ts + the webhook vocabularies).
 *
 * Steady-state bookings (no courier status yet) are DISPATCHED ⇒ eligible.
 */
export const PRE_PICKUP_COURIER_STATUSES: Record<
  string,
  { eligible: string[]; ineligible: string[] }
> = {
  pathao: {
    eligible: ['order.created', 'pending', 'order.pickup-failed', 'pickup failed'],
    ineligible: [
      'order.picked',
      'pickup',
      'picked',
      'order.assigned-for-pickup',
      'order.at-the-sorting-hub',
      'order.in-transit',
      'order.received-at-last-mile-hub',
      'order.assigned-for-delivery',
      'order.delivered',
      'order.partial-delivery',
      'order.on-hold',
      'order.returned',
    ],
  },
  steadfast: {
    eligible: ['in_review'],
    ineligible: [
      'pending',
      'picked_up',
      'in_transit',
      'delivered',
      'partial',
      'hold',
      'return_pending',
      'returned',
    ],
  },
  redx: {
    eligible: ['pickup-pending', 'pickup_pending'],
    ineligible: [
      'ready-for-delivery',
      'delivery-in-progress',
      'delivered',
      'agent-hold',
      'agent-returning',
      'returned',
      'paid',
    ],
  },
  carrybee: {
    eligible: ['order.created', 'order.pickup-failed', 'pickup-failed', 'pickup failed'],
    ineligible: [
      'order.picked',
      'order.at-the-sorting-hub',
      'order.in-transit',
      'order.received-at-last-mile-hub',
      'order.assigned-for-delivery',
      'order.delivered',
      'order.partial-delivery',
      'order.delivery-on-hold',
      'order.returned',
    ],
  },
};
