import { mapCourierStatusToDispatchStatus, isSupportedCourier } from './courier-status-mapper';

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

  it('maps RedX statuses (shared webhook/tracking vocabulary)', () => {
    expect(mapCourierStatusToDispatchStatus('redx', 'delivered')).toBe('DELIVERED');
    expect(mapCourierStatusToDispatchStatus('redx', 'ready-for-delivery')).toBe('PICKED_UP');
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

  it('steadfast "unknown" maps to CANCELLED (webhook parity)', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'unknown')).toBe('CANCELLED');
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
});