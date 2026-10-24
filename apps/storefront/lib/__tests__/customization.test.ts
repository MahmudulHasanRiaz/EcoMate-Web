import { describe, it, expect } from 'vitest';
import {
  sanitizeDefinition,
  buildCartCustomization,
  selectionAddon,
  selectionKey,
  cartLineTotal,
} from '../customization';

const RAW_DEF = [
  {
    key: 'engraving', label: 'Engraving', type: 'single', required: true,
    options: [
      { key: 'gold', label: 'Gold Foil', priceDelta: 120, costDelta: 40, pricingKind: 'per_unit' },
      { key: 'plain', label: 'Plain Etch', priceDelta: 50, costDelta: 10, pricingKind: 'per_unit' },
    ],
  },
  {
    key: 'gift', label: 'Gift Wrap', type: 'single', required: false,
    options: [
      { key: 'box', label: 'Gift Box', priceDelta: 80, costDelta: 30, pricingKind: 'per_line' },
    ],
  },
  { key: 'note', label: 'Gift Note', type: 'text', required: false, maxLength: 20, priceDelta: 0, costDelta: 0 },
];

describe('sanitizeDefinition', () => {
  it('keeps the public shape and strips cost deltas', () => {
    const def = sanitizeDefinition(RAW_DEF);
    expect(def).toHaveLength(3);
    expect(JSON.stringify(def)).not.toContain('costDelta');
    expect(def[0].options?.[0]).toEqual({
      key: 'gold', label: 'Gold Foil', priceDelta: 120, pricingKind: 'per_unit',
    });
  });

  it('returns [] for garbage input', () => {
    expect(sanitizeDefinition(null)).toEqual([]);
    expect(sanitizeDefinition('x')).toEqual([]);
    expect(sanitizeDefinition([{ noKey: 1 }])).toEqual([]);
  });
});

describe('selection math', () => {
  const def = sanitizeDefinition(RAW_DEF);
  const selection = {
    groups: [
      { key: 'engraving', optionKeys: ['gold'] },
      { key: 'gift', optionKeys: ['box'] },
    ],
  };

  it('splits per-unit vs per-line add-ons', () => {
    expect(selectionAddon(def, selection)).toEqual({ perUnit: 120, perLine: 80 });
  });

  it('builds display lines + totals for the cart', () => {
    const cart = buildCartCustomization(def, selection);
    expect(cart?.lines).toEqual([
      { label: 'Engraving', value: 'Gold Foil' },
      { label: 'Gift Wrap', value: 'Gift Box' },
    ]);
    expect(cart?.addonPerUnit).toBe(120);
    expect(cart?.addonPerLine).toBe(80);
    // (700 + 120) × 3 + 80 = 2540
    expect(cartLineTotal({ price: 700, quantity: 3, customization: cart })).toBe(2540);
  });

  it('an empty answer builds no cart customization', () => {
    expect(buildCartCustomization(def, { groups: [] })).toBeNull();
    expect(buildCartCustomization(def, undefined)).toBeNull();
  });

  it('different selections produce different cart keys; ordering does not matter', () => {
    const a = selectionKey(selection);
    const b = selectionKey({ groups: [{ key: 'gift', optionKeys: ['box'] }, { key: 'engraving', optionKeys: ['gold'] }] });
    const c = selectionKey({ groups: [{ key: 'engraving', optionKeys: ['plain'] }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
