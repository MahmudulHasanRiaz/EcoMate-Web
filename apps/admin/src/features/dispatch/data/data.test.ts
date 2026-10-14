import { describe, it, expect } from 'vitest';
import { DISPATCH_STATUSES, getDispatchIdentifierLabels } from './data';

describe('DISPATCH_STATUSES', () => {
  it('labels the PICKED_UP status as "Picked Up" (regression: was "icked Up")', () => {
    const picked = DISPATCH_STATUSES.find((s) => s.value === 'PICKED_UP');
    expect(picked?.label).toBe('Picked Up');
  });

  it('has no empty, truncated, or first-letter-dropped labels', () => {
    for (const s of DISPATCH_STATUSES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.label).not.toBe('icked Up');
      expect(s.label).toMatch(/^[A-Z]/);
    }
  });

  it('has unique values matching the backend webhook statuses', () => {
    const values = DISPATCH_STATUSES.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain('PICKED_UP');
  });

  // Task 3 / Fix 7: PICKUP_FAILED + ASSIGNED_TO_HUB filter options exist.
  it('includes the PICKUP_FAILED + ASSIGNED_TO_HUB workflow states', () => {
    const byValue = new Map(DISPATCH_STATUSES.map((s) => [s.value, s.label]));
    expect(byValue.get('PICKUP_FAILED')).toBe('Pickup Failed');
    expect(byValue.get('ASSIGNED_TO_HUB')).toBe('At Last-Mile Hub');
  });
});

describe('getDispatchIdentifierLabels', () => {
  it('labels steadfast identifiers as consignment ID + tracking code', () => {
    expect(getDispatchIdentifierLabels('steadfast')).toEqual({
      primary: 'Consignment ID',
      secondary: 'Tracking code',
    });
  });

  it('labels pathao with consignment ID only', () => {
    expect(getDispatchIdentifierLabels('pathao')).toEqual({
      primary: 'Consignment ID',
    });
  });

  it('labels redx with tracking ID', () => {
    expect(getDispatchIdentifierLabels('redx')).toEqual({
      primary: 'Tracking ID',
    });
  });

  it('labels carrybee with the merchant-panel parcel ID', () => {
    expect(getDispatchIdentifierLabels('carrybee')).toEqual({
      primary: 'Parcel ID',
    });
  });

  it('falls back to consignment ID for unknown couriers', () => {
    expect(getDispatchIdentifierLabels('paperfly')).toEqual({
      primary: 'Consignment ID',
    });
  });
});
