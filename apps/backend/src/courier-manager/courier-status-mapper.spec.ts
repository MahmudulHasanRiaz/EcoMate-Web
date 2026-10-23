import { mapCourierStatusToDispatchStatus, isSupportedCourier, mapSteadfastReturnStatus } from './courier-status-mapper';

describe('mapCourierStatusToDispatchStatus', () => {
  it('maps Steadfast tracking-normalized statuses', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'delivered')).toBe('DELIVERED');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'in_transit')).toBe('IN_TRANSIT');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'picked_up')).toBe('PICKED_UP');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'return_pending')).toBe('RETURN_PENDING');
    // Sheet Rule 25: back-with-merchant caps at RETURN_PENDING.
    expect(mapCourierStatusToDispatchStatus('steadfast', 'returned')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'hold')).toBe('HOLD');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'partial')).toBe('PARTIAL');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'cancelled')).toBe('CANCELLED');
  });

  it('maps the current Packzy approval-pending/in_review statuses (official API docs)', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'in_review')).toBe('DISPATCHED');
    // Delivered/cancelled awaiting admin approval — keep at rider stage.
    expect(mapCourierStatusToDispatchStatus('steadfast', 'delivered_approval_pending')).toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'cancelled_approval_pending')).toBe('ASSIGNED_TO_RIDER');
    // Partial delivery awaiting approval — still a partial (authoritative rule).
    expect(mapCourierStatusToDispatchStatus('steadfast', 'partial_delivered_approval_pending')).toBe('PARTIAL');
    // Unknown awaiting approval — never force a status.
    expect(mapCourierStatusToDispatchStatus('steadfast', 'unknown_approval_pending')).toBeNull();
  });

  it('maps RedX statuses (shared webhook/tracking vocabulary)', () => {
    expect(mapCourierStatusToDispatchStatus('redx', 'delivered')).toBe('DELIVERED');
    // Task A: ready-for-delivery = received from merchant, rider not yet
    // assigned → ASSIGNED_TO_RIDER (was PICKED_UP), order stays Shipping.
    expect(mapCourierStatusToDispatchStatus('redx', 'ready-for-delivery')).toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('redx', 'delivery-in-progress')).toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('redx', 'agent-hold')).toBe('HOLD');
    expect(mapCourierStatusToDispatchStatus('redx', 'agent-returning')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('redx', 'returned')).toBe('RETURN_PENDING');
  });

  it('maps Pathao webhook-event labels', () => {
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.delivered')).toBe('DELIVERED');
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.picked')).toBe('PICKED_UP');
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.at-the-sorting-hub')).toBe('IN_TRANSIT');
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.assigned-for-delivery')).toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.returned-to-merchant')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.on-hold')).toBe('HOLD');
  });

  it('maps Pathao plain status labels (official /orders/{id}/info vocabulary) before keyword fallback', () => {
    // `deliver` keyword must NOT win over "Assigned for Delivery" / "On Hold".
    expect(mapCourierStatusToDispatchStatus('pathao', 'Assigned for Delivery')).toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('pathao', 'assigned for delivery')).toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Assigned For Pickup')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'Pickup Requested')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'At the Sorting Hub')).toBe('IN_TRANSIT');
    expect(mapCourierStatusToDispatchStatus('pathao', 'In Transit')).toBe('IN_TRANSIT');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Received at Last Mile Hub')).toBe('ASSIGNED_TO_HUB');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Partial Delivery')).toBe('PARTIAL');
    expect(mapCourierStatusToDispatchStatus('pathao', 'On Hold')).toBe('HOLD');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Return')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Paid Return')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Exchange')).toBe('DELIVERED');
    // Task 3 (owner-locked F7): pickup-failed is a real workflow state
    // (PICKUP_FAILED), delivery-failed stays record-only (null).
    expect(mapCourierStatusToDispatchStatus('pathao', 'Pickup Failed')).toBe('PICKUP_FAILED');
    expect(mapCourierStatusToDispatchStatus('carrybee', 'Pickup Failed')).toBe('PICKUP_FAILED');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Delivery Failed')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'Payment Invoice')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'Pending')).toBe('DISPATCHED');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Pickup')).toBe('PICKED_UP');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Delivered')).toBe('DELIVERED');
  });

  it('webhook-skip statuses map to null (never promoted by keyword fallback)', () => {
    // Pathao/Carrybee webhooks explicitly map these to null ("skip").
    // Task 3 (owner-locked F7): order.pickup-failed is NOT skip anymore — it
    // is a real PICKUP_FAILED workflow state (asserted here + below).
    const skipLabels = [
      'order.updated',
      'order.pickup-requested',
      'order.assigned-for-pickup',
      'order.delivery-failed',
    ];
    for (const label of skipLabels) {
      expect(mapCourierStatusToDispatchStatus('pathao', label)).toBeNull();
      expect(mapCourierStatusToDispatchStatus('carrybee', label)).toBeNull();
    }
    // Plain (non event-prefixed) failure labels from tracking timelines must
    // never collide with `deliver`/`pickup` keyword rules. delivery-failed
    // stays record-only; pickup-failed is the PICKUP_FAILED state.
    expect(mapCourierStatusToDispatchStatus('pathao', 'delivery-failed')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'pickup failed')).toBe('PICKUP_FAILED');
    expect(mapCourierStatusToDispatchStatus('carrybee', 'Delivery Failed')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('carrybee', 'pickup-failed')).toBe('PICKUP_FAILED');
    expect(mapCourierStatusToDispatchStatus('redx', 'delivery-failed')).toBeNull();
  });

  // Task 3 (owner-locked F7): pickup-failed → PICKUP_FAILED (Pathao +
  // Carrybee, event + plain labels); received-at-last-mile-hub →
  // ASSIGNED_TO_HUB; ASSIGNED_TO_RIDER is ONLY for assigned-for-delivery.
  it('maps pickup-failed → PICKUP_FAILED and last-mile-hub → ASSIGNED_TO_HUB', () => {
    for (const courier of ['pathao', 'carrybee']) {
      expect(mapCourierStatusToDispatchStatus(courier, 'order.pickup-failed')).toBe('PICKUP_FAILED');
      expect(mapCourierStatusToDispatchStatus(courier, 'order.received-at-last-mile-hub')).toBe('ASSIGNED_TO_HUB');
      expect(mapCourierStatusToDispatchStatus(courier, 'order.assigned-for-delivery')).toBe('ASSIGNED_TO_RIDER');
      // delivery-failed stays record-only (never a workflow state).
      expect(mapCourierStatusToDispatchStatus(courier, 'order.delivery-failed')).toBeNull();
    }
    // ASSIGNED_TO_RIDER producers for pathao/carrybee: assigned-for-delivery
    // ONLY — hub + pickup-failed must never yield it.
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.received-at-last-mile-hub')).not.toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.pickup-failed')).not.toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('carrybee', 'order.received-at-last-mile-hub')).not.toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('carrybee', 'order.pickup-failed')).not.toBe('ASSIGNED_TO_RIDER');
  });

  it('steadfast "unknown" maps to null + alert (never CANCELLED)', () => {
    // Task A: "unknown" = courier cannot determine the state — keep the
    // previous workflow status; the webhook raises the staff alert instead.
    expect(mapCourierStatusToDispatchStatus('steadfast', 'unknown')).toBeNull();
  });

  it('maps Carrybee webhook-event labels', () => {
    expect(mapCourierStatusToDispatchStatus('carrybee', 'order.partial-delivery')).toBe('PARTIAL');
    expect(mapCourierStatusToDispatchStatus('carrybee', 'order.returned-in-transit')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('carrybee', 'order.create-failed')).toBe('CANCELLED');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', '  Delivered ')).toBe('DELIVERED');
    expect(mapCourierStatusToDispatchStatus('redx', 'DELIVERED')).toBe('DELIVERED');
  });

  it('falls back to keyword matching for unmapped labels', () => {
    expect(mapCourierStatusToDispatchStatus('pathao', 'delivered')).toBe('DELIVERED');
    expect(mapCourierStatusToDispatchStatus('carrybee', 'pickup completed')).toBe('PICKED_UP');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'parcel in transit')).toBe('IN_TRANSIT');
    // "partial" must win over "delivered"
    expect(mapCourierStatusToDispatchStatus('redx', 'partial_delivered')).toBe('PARTIAL');
    // Sheet Rule 25: no courier label yields RETURNED (staff receipt only).
    expect(mapCourierStatusToDispatchStatus('steadfast', 'returned item')).toBe('RETURN_PENDING');
  });

  it('returns null for empty/unknown statuses (no forced change)', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', '')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('steadfast', null)).toBeNull();
    expect(mapCourierStatusToDispatchStatus('steadfast', undefined)).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'some-garbage-label')).toBeNull();
  });

  it('isSupportedCourier only accepts configured providers', () => {
    expect(isSupportedCourier('steadfast')).toBe(true);
    expect(isSupportedCourier('pathao')).toBe(true);
    expect(isSupportedCourier('redx')).toBe(true);
    expect(isSupportedCourier('carrybee')).toBe(true);
    expect(isSupportedCourier('hoorin')).toBe(false);
    expect(isSupportedCourier('')).toBe(false);
  });

  // Task 6 (Fix 13, rows 39–40 owner-locked): partial in-progress return
  // labels ride RETURN_PENDING (parcel on its way back — no longer a plain
  // PARTIAL hold); the ORDER keeps its Partial outcome (never Delivered).
  // Only partial_delivered_return_received keeps PARTIAL.
  it('maps the 6 Steadfast return statuses (return endpoint vocabulary)', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'cancelled_return_proccessing')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'cancelled_return_rider_assigned')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'cancelled_return_received')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'partial_delivered_return_proccessing')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'partial_delivered_return_rider_assigned')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'partial_delivered_return_received')).toBe('PARTIAL');
  });

  // Task 5 (owner-locked): exceptional → keep previous status. There is no
  // EXCEPTION value in the DispatchStatus enum, so the mapper yields null
  // (no forced change) and the webhook raises the staff alert instead.
  it('maps Steadfast exceptional to null (never HOLD/DELIVERED/settle)', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'exceptional')).toBeNull();
  });

  // Task 5 (owner-locked): RedX pickup-pending = booked awaiting pickup =
  // internal DISPATCHED (Dispatch default status; order.created → DISPATCHED).
  it('maps RedX pickup-pending to DISPATCHED', () => {
    expect(mapCourierStatusToDispatchStatus('redx', 'pickup-pending')).toBe('DISPATCHED');
    expect(mapCourierStatusToDispatchStatus('redx', 'pickup_pending')).toBe('DISPATCHED');
  });

  // Task 5 (owner-locked): settle exclusion — exceptional and every
  // *_approval_pending label must NEVER resolve to DELIVERED.
  it('never maps exceptional/approval-pending labels to DELIVERED', () => {
    const neverDelivered = [
      'exceptional',
      'delivered_approval_pending',
      'partial_delivered_approval_pending',
      'cancelled_approval_pending',
      'unknown_approval_pending',
    ];
    for (const label of neverDelivered) {
      expect(mapCourierStatusToDispatchStatus('steadfast', label)).not.toBe('DELIVERED');
    }
  });
});

describe('mapSteadfastReturnStatus', () => {
  it('routes cancelled returns through RETURN_PENDING until the parcel is back', () => {
    expect(mapSteadfastReturnStatus('cancelled_return_proccessing')).toEqual(
      expect.objectContaining({ dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Return Pending', reconcileStock: false, codOwed: false }),
    );
    expect(mapSteadfastReturnStatus('cancelled_return_rider_assigned')).toEqual(
      expect.objectContaining({ dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Return Pending', reconcileStock: false, codOwed: false }),
    );
  });

  it('routes cancelled_return_received to RETURN_PENDING (staff-only RETURNED) with a stock reconcile and no COD', () => {
    // Sheet Rule 2 / 25: the courier delivering the return to us is at most
    // RETURN_PENDING — RETURNED only after staff physically receive it.
    expect(mapSteadfastReturnStatus('cancelled_return_received')).toEqual(
      expect.objectContaining({ dispatchStatus: 'RETURN_PENDING', reconcileStock: true, codOwed: false }),
    );
  });

  it('partial in-progress rides RETURN_PENDING + Partial; only receipt keeps PARTIAL', () => {
    // Task 6 (Fix 13, rows 39–40 owner-locked): partial in-progress labels
    // ride dispatch RETURN_PENDING while the ORDER keeps its Partial outcome.
    expect(mapSteadfastReturnStatus('partial_delivered_return_proccessing')).toEqual(
      expect.objectContaining({ dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Partial', reconcileStock: false, codOwed: false }),
    );
    expect(mapSteadfastReturnStatus('partial_delivered_return_rider_assigned')).toEqual(
      expect.objectContaining({ dispatchStatus: 'RETURN_PENDING', advanceOrder: 'Partial', reconcileStock: false, codOwed: false }),
    );
    expect(mapSteadfastReturnStatus('partial_delivered_return_received')).toEqual(
      expect.objectContaining({ dispatchStatus: 'PARTIAL', advanceOrder: 'Partial', reconcileStock: true, codOwed: false }),
    );
  });

  it('returns null for non-return statuses (normal sync owns those)', () => {
    expect(mapSteadfastReturnStatus('delivered')).toBeNull();
    expect(mapSteadfastReturnStatus('exceptional')).toBeNull();
    expect(mapSteadfastReturnStatus('delivered_approval_pending')).toBeNull();
    expect(mapSteadfastReturnStatus('')).toBeNull();
    expect(mapSteadfastReturnStatus(null)).toBeNull();
  });
});