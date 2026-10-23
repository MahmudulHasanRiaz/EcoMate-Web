import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CustomizationService } from './customization.service';
import { hasCustomization } from './customization.types';

const definition = [
  {
    key: 'engraving',
    label: 'Name Engraving',
    type: 'single',
    required: false,
    options: [
      { key: 'gold', label: 'Gold Foil', priceDelta: 120, costDelta: 40, pricingKind: 'per_unit' },
      { key: 'plain', label: 'Plain Etch', priceDelta: 50, costDelta: 10, pricingKind: 'per_unit' },
    ],
  },
  {
    key: 'extras',
    label: 'Extras',
    type: 'multi',
    required: false,
    options: [
      { key: 'gift_box', label: 'Gift Box', priceDelta: 80, costDelta: 30, pricingKind: 'per_line' },
      { key: 'wrap', label: 'Premium Wrap', priceDelta: 20, costDelta: 5, pricingKind: 'per_unit' },
    ],
  },
  {
    key: 'engraving_text',
    label: 'Engraving Text',
    type: 'text',
    required: false,
    maxLength: 20,
    priceDelta: 0,
    costDelta: 0,
  },
];

function makeService(enabled = true) {
  return new CustomizationService({ canUse: () => enabled } as any);
}

describe('CustomizationService', () => {
  it('license gate: assertEnabled throws when the feature is off', () => {
    expect(() => makeService(false).assertEnabled()).toThrow(ForbiddenException);
    expect(() => makeService(true).assertEnabled()).not.toThrow();
  });

  it('wallet example: gold engraving + gift box on qty 1 → 200 sell / 70 cost, snapshot frozen with labels', () => {
    const r = makeService().resolveSelection({
      definition,
      selection: {
        groups: [
          { key: 'engraving', optionKeys: ['gold'] },
          { key: 'extras', optionKeys: ['gift_box'] },
          { key: 'engraving_text', text: 'Riaz' },
        ],
      },
      quantity: 1,
      productName: 'Wallet',
    });
    expect(r.addonAmount).toBe(200);
    expect(r.addonCostAmount).toBe(70);
    expect(r.snapshot?.groups[0].options[0].label).toBe('Gold Foil');
    expect(r.snapshot?.groups[2].text).toBe('Riaz');
    expect(hasCustomization(r.snapshot)).toBe(true);
  });

  it('per_unit scales with quantity, per_line does not', () => {
    const r = makeService().resolveSelection({
      definition,
      selection: {
        groups: [
          { key: 'engraving', optionKeys: ['gold'] },
          { key: 'extras', optionKeys: ['gift_box', 'wrap'] },
        ],
      },
      quantity: 3,
    });
    // gold 120*3 + box 80 + wrap 20*3 = 500; cost 40*3 + 30 + 5*3 = 165
    expect(r.addonAmount).toBe(500);
    expect(r.addonCostAmount).toBe(165);
  });

  it('client-sent prices are ignored — only keys resolve against the definition', () => {
    const r = makeService().resolveSelection({
      definition,
      selection: {
        groups: [
          { key: 'engraving', optionKeys: ['gold'], priceDelta: 1 } as any,
        ],
      },
      quantity: 1,
    });
    expect(r.addonAmount).toBe(120);
  });

  it('rejects unknown option, unknown group, single with two choices, over-length text', () => {
    const svc = makeService();
    expect(() =>
      svc.resolveSelection({ definition, selection: { groups: [{ key: 'engraving', optionKeys: ['nope'] }] }, quantity: 1 }),
    ).toThrow(BadRequestException);
    expect(() =>
      svc.resolveSelection({ definition, selection: { groups: [{ key: 'nope', optionKeys: [] }] }, quantity: 1 }),
    ).toThrow(/Unknown customization group/);
    expect(() =>
      svc.resolveSelection({ definition, selection: { groups: [{ key: 'engraving', optionKeys: ['gold', 'plain'] }] }, quantity: 1 }),
    ).toThrow(/only one choice/);
    expect(() =>
      svc.resolveSelection({ definition, selection: { groups: [{ key: 'engraving_text', text: 'x'.repeat(21) }] }, quantity: 1 }),
    ).toThrow(/at most 20 characters/);
  });

  it('required group missing → throws; empty selection → null snapshot, zero amounts', () => {
    const svc = makeService();
    const requiredDef = [{ ...definition[0], required: true }];
    expect(() =>
      svc.resolveSelection({ definition: requiredDef, selection: { groups: [] }, quantity: 1 }),
    ).toThrow(/required/);
    const empty = svc.resolveSelection({
      definition,
      selection: { groups: [{ key: 'extras', optionKeys: [] }] },
      quantity: 2,
    });
    expect(empty.snapshot).toBeNull();
    expect(empty.addonAmount).toBe(0);
  });

  it('selection for a product without a definition → throws', () => {
    expect(() =>
      makeService().resolveSelection({
        definition: null,
        selection: { groups: [{ key: 'a', optionKeys: ['b'] }] },
        quantity: 1,
      }),
    ).toThrow(/does not offer customization/);
  });

  it('parseDefinition rejects malformed definitions (dup keys, empty options, bad deltas)', () => {
    const svc = makeService();
    expect(() => svc.parseDefinition([{ key: 'a', label: 'A', type: 'single', options: [] }])).toThrow();
    expect(() =>
      svc.parseDefinition([
        { key: 'a', label: 'A', type: 'text' },
        { key: 'a', label: 'A2', type: 'text' },
      ]),
    ).toThrow(/Duplicate/);
    expect(() =>
      svc.parseDefinition([
        { key: 'a', label: 'A', type: 'single', options: [{ key: 'x', label: 'X', priceDelta: -5, costDelta: 0 }] },
      ]),
    ).toThrow(/≥ 0/);
    expect(svc.parseDefinition(null)).toEqual([]);
    expect(svc.parseDefinition(definition)).toHaveLength(3);
  });

  it('totalsFromSnapshot rescales per-unit amounts on quantity change without the live definition', () => {
    const svc = makeService();
    const { snapshot } = svc.resolveSelection({
      definition,
      selection: {
        groups: [
          { key: 'engraving', optionKeys: ['gold'] },
          { key: 'extras', optionKeys: ['gift_box'] },
        ],
      },
      quantity: 1,
    });
    expect(svc.totalsFromSnapshot(snapshot, 4)).toEqual({
      addonAmount: 120 * 4 + 80,
      addonCostAmount: 40 * 4 + 30,
    });
    expect(svc.totalsFromSnapshot(null, 4)).toEqual({ addonAmount: 0, addonCostAmount: 0 });
  });
});
