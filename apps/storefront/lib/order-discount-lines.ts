// Customer-facing discount breakdown for a stored order.
//
// WHY THIS EXISTS (2026-10-27): Order.discount is NOT a money amount when
// discountType is 'percentage' — order creation stores the coupon/manual
// PERCENT there (orders.service.ts coupon path stores cappedPercent, and
// the monetary amount is folded into `total` but never stored separately).
// Rendering order.discount as money showed "−৳10.00" for a 10% coupon whose
// real discount was ৳4.50 (ORD-261027-0001). Admin converts percent →
// money before display (order-summary-card.tsx); the thank-you page
// rendered the raw value.
//
// The coupon/manual monetary amount is therefore derived from the order's
// own arithmetic — Subtotal + Shipping − Auto − Total — which always
// reconciles with the displayed total, including percentage-cap cases
// (where a direct percent × base computation would overstate) and later
// staff edits. Only when `total` is absent, or the residual is negative
// (inconsistent data), do we fall back to the direct creation formula:
// percentage of the post-automatic base, flat capped at that base.
//
// Labels follow the checkout convention: coupon/manual stays the generic
// "Discount" (the coupon code is not stored on the order, so it cannot be
// named here — the same reason admin's label is generic); automatic
// discounts are labelled per campaign when the breakdown carries titles.

export interface DiscountLine {
  label: string;
  amount: number;
}

export interface StoredOrderDiscounts {
  subtotal?: number | string | null;
  shippingCharge?: number | string | null;
  discount?: number | string | null;
  discountType?: string | null;
  autoDiscount?: number | string | null;
  total?: number | string | null;
  autoDiscountBreakdown?: {
    byDiscount?: {
      discountTitle?: string | null;
      amount?: number | string | null;
    }[] | null;
  } | null;
}

const nn = (v: number | string | undefined | null): number => {
  if (v === undefined || v === null) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};

const round2 = (v: number): number =>
  Math.round((v + Number.EPSILON) * 100) / 100;

export function getDiscountLines(order: StoredOrderDiscounts): DiscountLine[] {
  const lines: DiscountLine[] = [];
  const subtotal = nn(order.subtotal);
  const shipping = nn(order.shippingCharge);
  const auto = nn(order.autoDiscount);
  const stored = nn(order.discount);

  if (auto > 0) {
    const byDiscount = Array.isArray(order.autoDiscountBreakdown?.byDiscount)
      ? order.autoDiscountBreakdown.byDiscount.filter(
          (b) => b && nn(b.amount) > 0,
        )
      : [];
    if (byDiscount.length > 0) {
      for (const b of byDiscount) {
        const title = (b.discountTitle || '').trim();
        lines.push({
          label: title ? `Automatic discount (${title})` : 'Automatic discount',
          amount: round2(nn(b.amount)),
        });
      }
    } else {
      lines.push({ label: 'Automatic discount', amount: round2(auto) });
    }
  }

  if (stored > 0) {
    let amount: number | null = null;
    const hasTotal = order.total !== undefined && order.total !== null;
    if (hasTotal) {
      const residual = round2(subtotal + shipping - auto - nn(order.total));
      if (residual >= 0) amount = residual;
    }
    if (amount === null) {
      // Fallback: direct creation formula (post-automatic base).
      const base = Math.max(0, subtotal - auto);
      amount =
        order.discountType === 'percentage'
          ? round2((base * stored) / 100)
          : round2(Math.min(stored, base));
    }
    if (amount > 0) {
      lines.push({ label: 'Discount', amount });
    }
  }

  return lines;
}
