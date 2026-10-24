import { useEffect, useState } from "react";
import type { CartItem } from "@/lib/types";
import { evaluateDiscounts } from "@/lib/api/orders";

/**
 * D19 — Automatic campaign discounts for a cart (or Buy Now item).
 * Combo lines are excluded, exactly like the order-creation hook: bundle
 * pricing has no product/category scope. Add-on amounts fold into the
 * evaluated line totals, matching the backend engine.
 */
export function useAutoDiscounts(items: CartItem[], couponCode?: string) {
  const [result, setResult] = useState<{
    autoDiscount: number;
    byDiscount: { discountId: string; discountTitle: string; amount: number }[];
  }>({ autoDiscount: 0, byDiscount: [] });

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
      return;
    }
    let cancelled = false;
    evaluateDiscounts(evalItems, couponCode)
      .then((r) => {
        if (!cancelled) {
          setResult({
            autoDiscount: r.autoDiscount ?? 0,
            byDiscount: r.byDiscount ?? [],
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return result;
}
