import { describe, it, expect } from 'vitest';
import { DISPATCH_STATUSES } from './data';

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
});
