import { describe, it, expect } from 'vitest';
import { getDiscountLines } from '../lib/order-discount-lines';

describe('getDiscountLines', () => {
  it('live repro: 10% coupon on ORD-261027-0001 shows 4.50, not the stored 10', () => {
    expect(
      getDiscountLines({
        subtotal: 44.99,
        shippingCharge: 150,
        discount: 10,
        discountType: 'percentage',
        autoDiscount: 0,
        total: 190.49,
      }),
    ).toEqual([{ label: 'Discount', amount: 4.5 }]);
  });

  it('flat coupon shows its stored amount', () => {
    expect(
      getDiscountLines({
        subtotal: 100,
        shippingCharge: 50,
        discount: 25,
        discountType: 'flat',
        total: 125,
      }),
    ).toEqual([{ label: 'Discount', amount: 25 }]);
  });

  it('coupon percent applies to the post-automatic base, and auto gets its own line', () => {
    expect(
      getDiscountLines({
        subtotal: 200,
        shippingCharge: 0,
        discount: 10,
        discountType: 'percentage',
        autoDiscount: 20,
        total: 162,
      }),
    ).toEqual([
      { label: 'Automatic discount', amount: 20 },
      { label: 'Discount', amount: 18 },
    ]);
  });

  it('capped percent coupon: residual is the capped amount, not percent x base', () => {
    // 10% of 1000 = 100, capped to 50 at creation; total reflects 50.
    expect(
      getDiscountLines({
        subtotal: 1000,
        shippingCharge: 0,
        discount: 10,
        discountType: 'percentage',
        total: 950,
      }),
    ).toEqual([{ label: 'Discount', amount: 50 }]);
  });

  it('auto discount with breakdown titles renders one labelled line per campaign', () => {
    expect(
      getDiscountLines({
        subtotal: 500,
        shippingCharge: 0,
        autoDiscount: 30,
        autoDiscountBreakdown: {
          byDiscount: [{ discountTitle: 'Winter Sale', amount: 30 }],
        },
        total: 470,
      }),
    ).toEqual([{ label: 'Automatic discount (Winter Sale)', amount: 30 }]);
  });

  it('auto discount without breakdown renders a single generic line', () => {
    expect(
      getDiscountLines({
        subtotal: 100,
        shippingCharge: 0,
        autoDiscount: 15,
        total: 85,
      }),
    ).toEqual([{ label: 'Automatic discount', amount: 15 }]);
  });

  it('no discounts renders no lines', () => {
    expect(getDiscountLines({ subtotal: 100, shippingCharge: 0, total: 100 })).toEqual([]);
    expect(getDiscountLines({})).toEqual([]);
  });

  it('missing total falls back to the direct creation formula', () => {
    expect(
      getDiscountLines({
        subtotal: 100,
        discount: 10,
        discountType: 'percentage',
      }),
    ).toEqual([{ label: 'Discount', amount: 10 }]);
  });

  it('negative residual (inconsistent total) falls back to the direct formula', () => {
    expect(
      getDiscountLines({
        subtotal: 100,
        shippingCharge: 0,
        discount: 10,
        discountType: 'percentage',
        total: 999,
      }),
    ).toEqual([{ label: 'Discount', amount: 10 }]);
  });

  it('flat fallback caps at the post-automatic base', () => {
    expect(
      getDiscountLines({
        subtotal: 80,
        discount: 100,
        discountType: 'flat',
      }),
    ).toEqual([{ label: 'Discount', amount: 80 }]);
  });

  it('live auto-only order ORD-261027-0003: titled auto line, no coupon line', () => {
    // 2 x Mens WordPress Hoodie LARGE, TEST-VERIFY V2 Discount −10.50,
    // 69.98 + 150.00 − 10.50 = 209.48. Old code rendered nothing here
    // because it only ever read order.discount (0 for auto-only orders).
    expect(
      getDiscountLines({
        subtotal: 69.98,
        shippingCharge: 150,
        discount: 0,
        autoDiscount: 10.5,
        autoDiscountBreakdown: {
          byDiscount: [{ discountTitle: 'TEST-VERIFY V2 Discount', amount: 10.5 }],
        },
        total: 209.48,
      }),
    ).toEqual([{ label: 'Automatic discount (TEST-VERIFY V2 Discount)', amount: 10.5 }]);
  });

  it('same auto-only order without breakdown falls back to the generic auto line', () => {
    expect(
      getDiscountLines({
        subtotal: 69.98,
        shippingCharge: 150,
        discount: 0,
        autoDiscount: 10.5,
        total: 209.48,
      }),
    ).toEqual([{ label: 'Automatic discount', amount: 10.5 }]);
  });
});
