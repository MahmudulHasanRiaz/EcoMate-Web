import { impliesPickup } from './dispatch-timestamps';

describe('impliesPickup', () => {
  it('treats explicit pickup and every later possession status as pickup', () => {
    expect(impliesPickup('PICKED_UP')).toBe(true);
    expect(impliesPickup('IN_TRANSIT')).toBe(true);
    expect(impliesPickup('ASSIGNED_TO_RIDER')).toBe(true);
    expect(impliesPickup('DELIVERED')).toBe(true);
    expect(impliesPickup('PARTIAL')).toBe(true);
    // A parcel cannot return to the merchant without first being picked up.
    expect(impliesPickup('RETURN_PENDING')).toBe(true);
    expect(impliesPickup('RETURNED')).toBe(true);
  });

  it('does not treat pre-pickup or non-possession statuses as pickup', () => {
    expect(impliesPickup('DISPATCHED')).toBe(false);
    expect(impliesPickup('HANDED_OVER')).toBe(false);
    expect(impliesPickup('HOLD')).toBe(false);
    expect(impliesPickup('CANCELLED')).toBe(false);
  });

  it('handles null/undefined/empty without throwing', () => {
    expect(impliesPickup(null)).toBe(false);
    expect(impliesPickup(undefined)).toBe(false);
    expect(impliesPickup('')).toBe(false);
  });
});
