import { mapCourierStatusToDispatchStatus, isSupportedCourier, mapSteadfastReturnStatus } from './courier-status-mapper';

describe('mapCourierStatusToDispatchStatus', () => {
  it('maps Steadfast tracking-normalized statuses', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'delivered')).toBe('DELIVERED');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'in_transit')).toBe('IN_TRANSIT');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'picked_up')).toBe('PICKED_UP');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'return_pending')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'returned')).toBe('RETURNED');
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
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.returned-to-merchant')).toBe('RETURNED');
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
    expect(mapCourierStatusToDispatchStatus('pathao', 'Received at Last Mile Hub')).toBe('ASSIGNED_TO_RIDER');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Partial Delivery')).toBe('PARTIAL');
    expect(mapCourierStatusToDispatchStatus('pathao', 'On Hold')).toBe('HOLD');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Return')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Paid Return')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Exchange')).toBe('DELIVERED');
    // Skip labels from the info vocabulary never get promoted.
    expect(mapCourierStatusToDispatchStatus('pathao', 'Pickup Failed')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'Delivery Failed')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'Payment Invoice')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'Pending')).toBe('DISPATCHED');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Pickup')).toBe('PICKED_UP');
    expect(mapCourierStatusToDispatchStatus('pathao', 'Delivered')).toBe('DELIVERED');
  });

  it('webhook-skip statuses map to null (never promoted by keyword fallback)', () => {
    // Pathao/Carrybee webhooks explicitly map these to null ("skip").
    const skipLabels = [
      'order.updated',
      'order.pickup-requested',
      'order.assigned-for-pickup',
      'order.pickup-failed',
      'order.delivery-failed',
    ];
    for (const label of skipLabels) {
      expect(mapCourierStatusToDispatchStatus('pathao', label)).toBeNull();
      expect(mapCourierStatusToDispatchStatus('carrybee', label)).toBeNull();
    }
    // Plain (non event-prefixed) failure labels from tracking timelines must
    // never collide with `deliver`/`pickup` keyword rules.
    expect(mapCourierStatusToDispatchStatus('pathao', 'delivery-failed')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('pathao', 'pickup failed')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('carrybee', 'Delivery Failed')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('redx', 'delivery-failed')).toBeNull();
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
    // "returned" must win over "return"
    expect(mapCourierStatusToDispatchStatus('steadfast', 'returned item')).toBe('RETURNED');
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

  // Task 5 (owner-locked): Steadfast return statuses come ONLY from
  // GET /status_with_return_status_by_cid. cancelled_* ride the
  // RETURNED/CANCELLED path, partial_* keep PARTIAL with a return state.
  it('maps the 6 Steadfast return statuses (return endpoint vocabulary)', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'cancelled_return_proccessing')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'cancelled_return_rider_assigned')).toBe('RETURN_PENDING');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'cancelled_return_received')).toBe('RETURNED');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'partial_delivered_return_proccessing')).toBe('PARTIAL');
    expect(mapCourierStatusToDispatchStatus('steadfast', 'partial_delivered_return_rider_assigned')).toBe('PARTIAL');
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

  it('routes cancelled_return_received to RETURNED with a stock reconcile and no COD', () => {
    expect(mapSteadfastReturnStatus('cancelled_return_received')).toEqual(
      expect.objectContaining({ dispatchStatus: 'RETURNED', reconcileStock: true, codOwed: false }),
    );
  });

  it('keeps PARTIAL for partial-delivered returns and reconciles stock only on receipt', () => {
    expect(mapSteadfastReturnStatus('partial_delivered_return_proccessing')).toEqual(
      expect.objectContaining({ dispatchStatus: 'PARTIAL', advanceOrder: 'Partial', reconcileStock: false, codOwed: false }),
    );
    expect(mapSteadfastReturnStatus('partial_delivered_return_rider_assigned')).toEqual(
      expect.objectContaining({ dispatchStatus: 'PARTIAL', advanceOrder: 'Partial', reconcileStock: false, codOwed: false }),
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