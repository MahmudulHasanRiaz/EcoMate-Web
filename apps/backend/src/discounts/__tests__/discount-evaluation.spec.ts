import {
  evaluateDiscounts,
  expandCategorySubtree,
  isDiscountActive,
  type CategoryNode,
  type DiscountLine,
  type DiscountRule,
} from '../discount-evaluation';

const NOW = new Date('2026-10-24T12:00:00Z');

function rule(over: Partial<DiscountRule>): DiscountRule {
  return {
    id: 'd1',
    title: 'Campaign',
    scope: 'SITEWIDE',
    categoryIds: [],
    productIds: [],
    type: 'percentage',
    value: 10,
    minOrderAmount: null,
    startsAt: null,
    endsAt: null,
    isActive: true,
    ...over,
  };
}

function line(over: Partial<DiscountLine>): DiscountLine {
  return {
    productId: 'p1',
    categoryIds: ['c1'],
    quantity: 2,
    unitPrice: 100,
    ...over,
  };
}

const CATS: CategoryNode[] = [
  { id: 'c1', parentId: null },
  { id: 'c2', parentId: 'c1' },
  { id: 'c3', parentId: 'c2' },
  { id: 'c9', parentId: null },
];

describe('discount evaluation engine (D19)', () => {
  it('applies a sitewide percentage to every line', () => {
    const res = evaluateDiscounts(
      [rule({})],
      [line({}), line({ productId: 'p2', categoryIds: ['c9'] })],
      400,
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(40);
    expect(res.lines).toHaveLength(2);
  });

  it('category scope matches the whole subtree (children + grandchildren)', () => {
    const res = evaluateDiscounts(
      [rule({ scope: 'CATEGORY', categoryIds: ['c1'] })],
      [
        line({ productId: 'p1', categoryIds: ['c1'] }),
        line({ productId: 'p2', categoryIds: ['c3'] }),
        line({ productId: 'p3', categoryIds: ['c9'] }),
      ],
      600,
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(40);
    expect(res.lines.map((l) => l.productId)).toEqual(['p1', 'p2']);
  });

  it('a product in a child category matches a discount on the parent', () => {
    expect(expandCategorySubtree(CATS, ['c1'])).toEqual(
      new Set(['c1', 'c2', 'c3']),
    );
  });

  it('product scope matches only listed products', () => {
    const res = evaluateDiscounts(
      [rule({ scope: 'PRODUCT', productIds: ['p2'] })],
      [line({}), line({ productId: 'p2' })],
      400,
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(20);
    expect(res.lines[0].productId).toBe('p2');
  });

  it('flat is per unit and capped at the line total', () => {
    const res = evaluateDiscounts(
      [rule({ type: 'flat', value: 100 })],
      [line({ quantity: 1, unitPrice: 60 })],
      60,
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(60);
    const res2 = evaluateDiscounts(
      [rule({ type: 'flat', value: 30 })],
      [line({ quantity: 3, unitPrice: 100 })],
      300,
      CATS,
      NOW,
    );
    expect(res2.totalDiscount).toBe(90);
  });

  it('per line, the largest discount wins (no stacking of automatic rules)', () => {
    const res = evaluateDiscounts(
      [
        rule({ id: 'd1', type: 'percentage', value: 10 }),
        rule({ id: 'd2', type: 'percentage', value: 25 }),
      ],
      [line({})],
      200,
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(50);
    expect(res.lines[0].discountId).toBe('d2');
  });

  it('a minimum-order condition blocks the rule below the threshold only', () => {
    const r = rule({ minOrderAmount: 500 });
    expect(isDiscountActive(r, 499, NOW)).toBe(false);
    expect(isDiscountActive(r, 500, NOW)).toBe(true);
  });

  it('schedule windows: future start inactive, open-ended end active, past end inactive', () => {
    expect(
      isDiscountActive(
        rule({ startsAt: new Date('2026-10-25T00:00:00Z') }),
        100,
        NOW,
      ),
    ).toBe(false);
    expect(
      isDiscountActive(
        rule({ startsAt: new Date('2026-10-20T00:00:00Z'), endsAt: null }),
        100,
        NOW,
      ),
    ).toBe(true);
    expect(
      isDiscountActive(
        rule({ endsAt: new Date('2026-10-23T00:00:00Z') }),
        100,
        NOW,
      ),
    ).toBe(false);
  });

  it('inactive rules never apply', () => {
    const res = evaluateDiscounts(
      [rule({ isActive: false })],
      [line({})],
      200,
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(0);
    expect(res.lines).toHaveLength(0);
  });

  it('add-on amounts fold into the discounted line total (Q14 parity)', () => {
    const res = evaluateDiscounts(
      [rule({})],
      [line({ unitPrice: 100, quantity: 1, addonAmount: 50 })],
      150,
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(15);
  });
});
