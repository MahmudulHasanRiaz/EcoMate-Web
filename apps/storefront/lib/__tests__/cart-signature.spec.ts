import { describe, it, expect } from 'vitest';
import { computeCartSignature } from '../cart-signature';

describe('computeCartSignature (spec §8 / D1 fix)', () => {
  const base = [
    { id: 'p1', name: 'Shampoo', price: 250, quantity: 2 },
    { id: 'p2', name: 'Soap', price: 80, quantity: 1 },
  ];

  it('returns a stable string for the same cart', () => {
    expect(computeCartSignature(base)).toBe(computeCartSignature(base));
  });

  it('encodes content_ids, quantities, and value into the signature', () => {
    const sig = computeCartSignature(base);
    expect(sig).toContain('p1,p2');
    expect(sig).toContain('p1:2');
    expect(sig).toContain('p2:1');
    // 250*2 + 80*1 = 580.00
    expect(sig).toContain('580.00');
  });

  it('produces a different signature when an item is added', () => {
    const added = [...base, { id: 'p3', price: 200, quantity: 1 }];
    expect(computeCartSignature(added)).not.toBe(computeCartSignature(base));
  });

  it('produces a different signature when an item is removed', () => {
    const removed = [base[0]];
    expect(computeCartSignature(removed)).not.toBe(computeCartSignature(base));
  });

  it('produces a different signature when quantity changes', () => {
    const changed = [{ ...base[0], quantity: 5 }, base[1]];
    expect(computeCartSignature(changed)).not.toBe(computeCartSignature(base));
  });

  it('produces a different signature when price/value changes', () => {
    const changed = [{ ...base[0], price: 999 }, base[1]];
    expect(computeCartSignature(changed)).not.toBe(computeCartSignature(base));
  });

  it('produces a different signature when content_ids order changes', () => {
    const reordered = [base[1], base[0]];
    expect(computeCartSignature(reordered)).not.toBe(computeCartSignature(base));
  });

  it('returns a stable signature for repeated React rerenders with the same items', () => {
    const render1 = computeCartSignature(base);
    const render2 = computeCartSignature([...base]);
    const render3 = computeCartSignature(base.map(i => ({ ...i })));
    expect(render1).toBe(render2);
    expect(render2).toBe(render3);
  });

  it('does NOT consider item name — name change alone does not mutate signature', () => {
    const renamed = [{ ...base[0], name: 'Renamed' }, base[1]];
    expect(computeCartSignature(renamed)).toBe(computeCartSignature(base));
  });

  it('returns a deterministic signature for an empty cart', () => {
    expect(computeCartSignature([])).toBe(computeCartSignature([]));
    expect(computeCartSignature([])).toBe('::::0.00');
  });
});
