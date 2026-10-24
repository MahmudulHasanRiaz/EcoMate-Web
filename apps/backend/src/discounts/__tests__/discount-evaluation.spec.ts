import {
  evaluateDiscounts,
  expandCategorySubtree,
  isOnSalePrice,
  isScheduleActive,
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
    variantIds: [],
    type: 'percentage',
    value: 10,
    minOrderAmount: null,
    minQuantity: null,
    excludeSaleItems: false,
    maxDiscountAmount: null,
    combineWithCoupon: true,
    maxUses: null,
    maxUsesPerCustomer: null,
    firstOrderOnly: false,
    priority: 0,
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

describe('discount evaluation engine (D19 + V2)', () => {
  it('applies a sitewide percentage to every line', () => {
    const res = evaluateDiscounts(
      [rule({})],
      [line({}), line({ productId: 'p2', categoryIds: ['c9'] })],
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
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(60);
    const res2 = evaluateDiscounts(
      [rule({ type: 'flat', value: 30 })],
      [line({ quantity: 3, unitPrice: 100 })],
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
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(50);
    expect(res.lines[0].discountId).toBe('d2');
  });

  it('schedule windows: future start inactive, open-ended end active, past end inactive', () => {
    expect(
      isScheduleActive(
        rule({ startsAt: new Date('2026-10-25T00:00:00Z') }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isScheduleActive(
        rule({ startsAt: new Date('2026-10-20T00:00:00Z'), endsAt: null }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isScheduleActive(rule({ endsAt: new Date('2026-10-23T00:00:00Z') }), NOW),
    ).toBe(false);
  });

  it('inactive rules never apply', () => {
    const res = evaluateDiscounts(
      [rule({ isActive: false })],
      [line({})],
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
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(15);
  });

  // ── Discount V2 ──

  it('V2: scoped minOrderAmount reads eligible lines only, not the whole cart', () => {
    const menRule = rule({
      scope: 'CATEGORY',
      categoryIds: ['c1'],
      minOrderAmount: 500,
    });
    // ৳50 of Men + ৳500 of other = ৳550 cart, but only ৳50 eligible.
    const blocked = evaluateDiscounts(
      [menRule],
      [
        line({ productId: 'p1', categoryIds: ['c1'], quantity: 1, unitPrice: 50 }),
        line({ productId: 'p9', categoryIds: ['c9'], quantity: 1, unitPrice: 500 }),
      ],
      CATS,
      NOW,
    );
    expect(blocked.totalDiscount).toBe(0);
    // ৳500 of Men + ৳100 of other: threshold met, discount on Men only.
    const applied = evaluateDiscounts(
      [menRule],
      [
        line({ productId: 'p1', categoryIds: ['c1'], quantity: 1, unitPrice: 500 }),
        line({ productId: 'p9', categoryIds: ['c9'], quantity: 1, unitPrice: 100 }),
      ],
      CATS,
      NOW,
    );
    expect(applied.totalDiscount).toBe(50);
    expect(applied.lines.map((l) => l.productId)).toEqual(['p1']);
  });

  it('V2: sitewide minOrderAmount still reads the whole cart (unchanged)', () => {
    const res = evaluateDiscounts(
      [rule({ minOrderAmount: 500 })],
      [line({ quantity: 1, unitPrice: 300 }), line({ productId: 'p2', quantity: 1, unitPrice: 300 })],
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(60);
  });

  it('V2: minQuantity counts total eligible units across lines', () => {
    const r = rule({ scope: 'PRODUCT', productIds: ['p1'], minQuantity: 2 });
    const blocked = evaluateDiscounts(
      [r],
      [line({ quantity: 1 })],
      CATS,
      NOW,
    );
    expect(blocked.totalDiscount).toBe(0);
    // Two lines of the same product, 1 unit each: 2 eligible units.
    const applied = evaluateDiscounts(
      [r],
      [line({ quantity: 1 }), line({ quantity: 1, variantId: 'v2' })],
      CATS,
      NOW,
    );
    expect(applied.totalDiscount).toBe(20);
    expect(applied.lines).toHaveLength(2);
  });

  it('V2: excludeSaleItems skips sale lines and excludes them from thresholds', () => {
    const r = rule({
      excludeSaleItems: true,
      minOrderAmount: 100,
    });
    // Sale line ৳200 + non-sale ৳50: eligible is ৳50 < 100, blocked.
    const blocked = evaluateDiscounts(
      [r],
      [
        line({ quantity: 1, unitPrice: 200, isOnSale: true }),
        line({ productId: 'p2', quantity: 1, unitPrice: 50 }),
      ],
      CATS,
      NOW,
    );
    expect(blocked.totalDiscount).toBe(0);
    // No threshold: sale line skipped, non-sale line discounted.
    const applied = evaluateDiscounts(
      [rule({ excludeSaleItems: true })],
      [
        line({ quantity: 1, unitPrice: 200, isOnSale: true }),
        line({ productId: 'p2', quantity: 1, unitPrice: 100 }),
      ],
      CATS,
      NOW,
    );
    expect(applied.totalDiscount).toBe(10);
    expect(applied.lines.map((l) => l.productId)).toEqual(['p2']);
  });

  it('V2: maxDiscountAmount caps the rule total, scaled proportionally', () => {
    const res = evaluateDiscounts(
      [rule({ type: 'percentage', value: 50, maxDiscountAmount: 150 })],
      [
        line({ quantity: 1, unitPrice: 200 }),
        line({ productId: 'p2', quantity: 1, unitPrice: 200 }),
      ],
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(150);
    expect(res.lines.map((l) => l.amount)).toEqual([75, 75]);
    expect(res.byDiscount[0].amount).toBe(150);
  });

  it('V2: cap rounding drift folds into the largest line, total stays exact', () => {
    const res = evaluateDiscounts(
      [rule({ type: 'percentage', value: 50, maxDiscountAmount: 70 })],
      [
        line({ quantity: 1, unitPrice: 100 }),
        line({ productId: 'p2', quantity: 1, unitPrice: 50 }),
      ],
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(70);
    expect(res.lines.reduce((s, l) => s + l.amount, 0)).toBe(70);
  });

  it('V2: combineWithCoupon=false suppresses the rule only when a coupon is present', () => {
    const r = rule({ combineWithCoupon: false });
    const withCoupon = evaluateDiscounts([r], [line({})], CATS, NOW, {
      couponPresent: true,
    });
    expect(withCoupon.totalDiscount).toBe(0);
    const withoutCoupon = evaluateDiscounts([r], [line({})], CATS, NOW, {
      couponPresent: false,
    });
    expect(withoutCoupon.totalDiscount).toBe(20);
  });

  it('V2: higher priority wins over a larger discount; ties go largest, then oldest', () => {
    const priorityWins = evaluateDiscounts(
      [
        rule({ id: 'd1', type: 'percentage', value: 10, priority: 1 }),
        rule({ id: 'd2', type: 'percentage', value: 25, priority: 0 }),
      ],
      [line({})],
      CATS,
      NOW,
    );
    expect(priorityWins.lines[0].discountId).toBe('d1');
    expect(priorityWins.totalDiscount).toBe(20);
    const tieOldest = evaluateDiscounts(
      [
        rule({ id: 'd1', type: 'percentage', value: 10 }),
        rule({ id: 'd2', type: 'percentage', value: 10 }),
      ],
      [line({})],
      CATS,
      NOW,
    );
    expect(tieOldest.lines[0].discountId).toBe('d1');
  });

  it('V2: variantIds narrow PRODUCT scope (missing variant never matches)', () => {
    const r = rule({
      scope: 'PRODUCT',
      productIds: ['p1'],
      variantIds: ['v1'],
    });
    const res = evaluateDiscounts(
      [r],
      [
        line({ variantId: 'v1' }),
        line({ productId: 'p1', variantId: 'v2' }),
        line({ productId: 'p1', variantId: null }),
      ],
      CATS,
      NOW,
    );
    expect(res.totalDiscount).toBe(20);
    expect(res.lines).toHaveLength(1);
  });

  it('V2: skipped rules explain why (below-minimum, coupon-present)', () => {
    const res = evaluateDiscounts(
      [
        rule({ id: 'd-min', scope: 'CATEGORY', categoryIds: ['c1'], minOrderAmount: 500 }),
        rule({ id: 'd-coupon', combineWithCoupon: false }),
      ],
      [line({ productId: 'p1', categoryIds: ['c1'], quantity: 1, unitPrice: 50 })],
      CATS,
      NOW,
      { couponPresent: true },
    );
    expect(res.totalDiscount).toBe(0);
    expect(res.skipped).toEqual([
      { discountId: 'd-min', discountTitle: 'Campaign', reason: 'below-minimum' },
      { discountId: 'd-coupon', discountTitle: 'Campaign', reason: 'coupon-present' },
    ]);
  });

  it('V2: isOnSalePrice mirrors the order price resolution', () => {
    const product = { salePrice: 80, basePrice: 100 };
    // Variant sale below its own price: on sale.
    expect(
      isOnSalePrice({ salePrice: 70, price: 90 }, product),
    ).toBe(true);
    // Variant with its own price shadows the parent sale: not on sale.
    expect(
      isOnSalePrice({ salePrice: null, price: 90 }, product),
    ).toBe(false);
    // Variant with neither price falls back to the parent sale: on sale.
    expect(
      isOnSalePrice({ salePrice: null, price: null }, product),
    ).toBe(true);
    // Parent sale at/above base: not on sale.
    expect(
      isOnSalePrice(null, { salePrice: 100, basePrice: 100 }),
    ).toBe(false);
    expect(
      isOnSalePrice(null, { salePrice: null, basePrice: 100 }),
    ).toBe(false);
    expect(
      isOnSalePrice(null, { salePrice: 80, basePrice: 100 }),
    ).toBe(true);
  });
});
