import { useEffect, useState } from "react";
import type { CartItem } from "@/lib/types";
import { evaluateDiscounts } from "@/lib/api/orders";

/**
 * D19 — Automatic campaign discounts for a cart (or Buy Now item).
 * Combo lines are excluded, exactly like the order-creation hook: bundle
 * pricing has no product/category scope. Add-on amounts fold into the
 * evaluated line totals, matching the backend engine.
 *
 * Combine-OFF safety: an evaluation result is only valid for the coupon
 * it was computed with. `evaluatedCouponCode` names that coupon (null =
 * no coupon); until the re-evaluation for the CURRENT coupon settles,
 * the previous result still describes the previous coupon. Callers must
 * not pair the stale auto value with the new coupon — that pairing is
 * the stacking bug (stale auto kept showing + coupon % computed on the
 * stale post-automatic base), and a failed evaluation would otherwise
 * leave it stacked forever, because failures used to be swallowed.
 */
export function useAutoDiscounts(items: CartItem[], couponCode?: string) {
  const [result, setResult] = useState<{
    autoDiscount: number;
    byDiscount: { discountId: string; discountTitle: string; amount: number }[];
  }>({ autoDiscount: 0, byDiscount: [] });
  const [evaluatedCouponCode, setEvaluatedCouponCode] = useState<
    string | null
  >(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluateError, setEvaluateError] = useState(false);

  const signature = JSON.stringify([
    couponCode ?? null,
    items
      .filter((i) => !i.isCombo)
      .map((i) => [
        i.id,
        i.variantId ?? null,
        i.quantity,
        i.price,
        i.customization?.addonPerUnit ?? 0,
        i.customization?.addonPerLine ?? 0,
      ]),
  ]);

  useEffect(() => {
    const evalItems = items
      .filter((i) => !i.isCombo)
      .map((i) => ({
        productId: i.id,
        variantId: i.variantId,
        quantity: i.quantity,
        unitPrice: i.price,
        addonAmount:
          (i.customization?.addonPerUnit ?? 0) * i.quantity +
          (i.customization?.addonPerLine ?? 0),
      }));
    if (evalItems.length === 0) {
      setResult({ autoDiscount: 0, byDiscount: [] });
      setEvaluatedCouponCode(couponCode ?? null);
      setIsEvaluating(false);
      setEvaluateError(false);
      return;
    }
    let cancelled = false;
    setIsEvaluating(true);
    setEvaluateError(false);
    evaluateDiscounts(evalItems, couponCode)
      .then((r) => {
        if (!cancelled) {
          setResult({
            autoDiscount: r.autoDiscount ?? 0,
            byDiscount: r.byDiscount ?? [],
          });
          // Only now does the result describe the current coupon.
          setEvaluatedCouponCode(couponCode ?? null);
          setIsEvaluating(false);
        }
      })
      .catch(() => {
        // Never present a stale evaluation as current: leave
        // evaluatedCouponCode untouched so callers keep gating on it,
        // and report the failure instead of swallowing it.
        if (!cancelled) {
          setIsEvaluating(false);
          setEvaluateError(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return { ...result, evaluatedCouponCode, isEvaluating, evaluateError };
}
