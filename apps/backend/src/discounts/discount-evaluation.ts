/**
 * D19 — Advanced (automatic) discount evaluation engine, extended by
 * Discount V2 (2026-10-24).
 *
 * Pure functions, no Nest/Prisma dependency, so the rules are unit-testable
 * in isolation and shared by the storefront evaluate endpoint and the
 * order-creation hook (both must agree to the cent).
 *
 * Rules (also documented on the Discount model):
 * - A rule is SCHEDULE-ACTIVE when isActive AND now >= startsAt (if set)
 *   AND now <= endsAt (if set — NULL endsAt = open-ended).
 * - Scope matching: SITEWIDE matches every line; CATEGORY matches a line
 *   when any of the product's categories falls inside the selected
 *   categories' SUBTREES (children, grandchildren, …); PRODUCT matches
 *   when the product id is listed AND (variantIds is empty OR the line's
 *   variant is listed). A line on sale (isOnSale) never matches a rule
 *   with excludeSaleItems.
 * - Thresholds are SCOPED: minOrderAmount compares against the subtotal
 *   of the rule's ELIGIBLE lines only (not the whole cart), and
 *   minQuantity against the total units of those lines. For SITEWIDE
 *   rules the eligible set is the whole cart, so behaviour is unchanged.
 * - Coupon interaction: when the order carries a coupon code, rules with
 *   combineWithCoupon=false do not apply at all (the coupon itself still
 *   applies, on the post-automatic base).
 * - Per line, at most ONE automatic discount applies: the highest
 *   priority wins; ties go to the largest line discount, then the
 *   earliest rule in input order (the service sorts by createdAt
 *   ascending, so oldest wins ties).
 * - percentage: lineTotal * value / 100. flat: value PER UNIT, capped at
 *   the line total (a ৳100 flat discount on a ৳60 line gives ৳60, never a
 *   negative line). Line totals include customization add-on amounts.
 * - maxDiscountAmount caps the rule's TOTAL discount across the order:
 *   when exceeded, its line amounts are scaled down proportionally and
 *   the rounding drift is folded into the largest line.
 */

export type DiscountScope = 'SITEWIDE' | 'CATEGORY' | 'PRODUCT';
export type DiscountType = 'percentage' | 'flat';

export interface DiscountRule {
  id: string;
  title: string;
  scope: DiscountScope;
  categoryIds: string[];
  productIds: string[];
  variantIds: string[];
  type: DiscountType;
  value: number;
  minOrderAmount: number | null;
  minQuantity: number | null;
  excludeSaleItems: boolean;
  maxDiscountAmount: number | null;
  combineWithCoupon: boolean;
  /** Service-level gates (counted from DiscountApplication rows); the
   * pure engine does not read them, but they ride the same rule shape. */
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  firstOrderOnly: boolean;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

export interface DiscountLine {
  productId: string;
  variantId?: string | null;
  categoryIds: string[];
  quantity: number;
  unitPrice: number;
  addonAmount?: number;
  /** True when the line price came from a sale price below regular. */
  isOnSale?: boolean;
}

export interface CategoryNode {
  id: string;
  parentId: string | null;
}

export interface EvaluatedLine {
  productId: string;
  discountId: string;
  discountTitle: string;
  amount: number;
}

export interface SkippedRule {
  discountId: string;
  discountTitle: string;
  /** below-minimum: an in-scope threshold was not reached.
   *  coupon-present: the order carries a coupon and the rule opts out. */
  reason: 'below-minimum' | 'coupon-present';
}

export interface EvaluationResult {
  totalDiscount: number;
  lines: EvaluatedLine[];
  byDiscount: { discountId: string; discountTitle: string; amount: number }[];
  /** Rules that were schedule-active but contributed nothing, with why —
   *  the answer to "why didn't my discount apply?" (caps and first-order
   *  are service-level gates and are appended by the service). */
  skipped: SkippedRule[];
}

export interface EvaluateOptions {
  /** True when the order carries a coupon code. */
  couponPresent?: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function expandCategorySubtree(
  categories: CategoryNode[],
  selectedIds: string[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of categories) {
    if (!c.parentId) continue;
    const list = children.get(c.parentId) ?? [];
    list.push(c.id);
    children.set(c.parentId, list);
  }
  const out = new Set<string>();
  const stack = [...selectedIds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return out;
}

/**
 * Whether a line price "came from a sale price", mirroring the order
 * path's price resolution exactly (variant.salePrice ?? variant.price ??
 * parent.salePrice ?? parent.basePrice; simple: salePrice ?? basePrice).
 * A variant with its own price shadows the parent's sale price — it is
 * NOT on sale. A variant with neither price falls back to the parent's
 * sale price. `null` prices mean the field is unset.
 */
export function isOnSalePrice(
  variant: { salePrice: number | null; price: number | null } | null,
  product: { salePrice: number | null; basePrice: number | null },
): boolean {
  if (variant) {
    if (variant.salePrice !== null) {
      const regular = variant.price ?? product.basePrice;
      return regular !== null && variant.salePrice < regular;
    }
    if (variant.price !== null) return false;
  }
  return (
    product.salePrice !== null &&
    product.basePrice !== null &&
    product.salePrice < product.basePrice
  );
}

/** Schedule gate only — conditions (thresholds, coupon) are per-cart. */
export function isScheduleActive(rule: DiscountRule, now: Date): boolean {
  if (!rule.isActive) return false;
  if (rule.startsAt && now < rule.startsAt) return false;
  if (rule.endsAt && now > rule.endsAt) return false;
  return true;
}

function lineTotal(line: DiscountLine): number {
  return line.unitPrice * line.quantity + (line.addonAmount ?? 0);
}

function discountForLine(
  rule: DiscountRule,
  line: DiscountLine,
): number | null {
  const total = lineTotal(line);
  if (total <= 0) return null;
  if (rule.type === 'percentage') {
    return round2((total * rule.value) / 100);
  }
  return round2(Math.min(rule.value * line.quantity, total));
}

export function evaluateDiscounts(
  rules: DiscountRule[],
  lines: DiscountLine[],
  categories: CategoryNode[],
  now: Date,
  options: EvaluateOptions = {},
): EvaluationResult {
  const scheduled = rules.filter((r) => isScheduleActive(r, now));
  const subtreeByRule = new Map<string, Set<string>>();
  for (const rule of scheduled) {
    if (rule.scope === 'CATEGORY') {
      subtreeByRule.set(
        rule.id,
        expandCategorySubtree(categories, rule.categoryIds),
      );
    }
  }
  const matches = (rule: DiscountRule, line: DiscountLine): boolean => {
    if (rule.excludeSaleItems && line.isOnSale) return false;
    if (rule.scope === 'SITEWIDE') return true;
    if (rule.scope === 'PRODUCT') {
      if (!rule.productIds.includes(line.productId)) return false;
      if (rule.variantIds.length > 0) {
        return !!line.variantId && rule.variantIds.includes(line.variantId);
      }
      return true;
    }
    const subtree = subtreeByRule.get(rule.id)!;
    return line.categoryIds.some((c) => subtree.has(c));
  };

  // Per-rule eligibility: scope match + scoped thresholds + coupon gate.
  // A rule that fails its thresholds contributes nothing, even to lines
  // it matches — thresholds are a property of the rule, not the line.
  const eligible = new Map<string, Set<number>>();
  const skipped: SkippedRule[] = [];
  for (const rule of scheduled) {
    if (options.couponPresent && !rule.combineWithCoupon) {
      skipped.push({
        discountId: rule.id,
        discountTitle: rule.title,
        reason: 'coupon-present',
      });
      continue;
    }
    const idxs = new Set<number>();
    let eligibleSubtotal = 0;
    let eligibleQty = 0;
    lines.forEach((line, i) => {
      if (!matches(rule, line)) return;
      idxs.add(i);
      eligibleSubtotal += lineTotal(line);
      eligibleQty += line.quantity;
    });
    if (
      (rule.minOrderAmount !== null &&
        eligibleSubtotal < rule.minOrderAmount) ||
      (rule.minQuantity !== null && eligibleQty < rule.minQuantity)
    ) {
      skipped.push({
        discountId: rule.id,
        discountTitle: rule.title,
        reason: 'below-minimum',
      });
      continue;
    }
    eligible.set(rule.id, idxs);
  }

  const evaluatedLines: EvaluatedLine[] = [];
  const byDiscount = new Map<
    string,
    { discountId: string; discountTitle: string; amount: number }
  >();
  const ruleById = new Map(scheduled.map((r) => [r.id, r]));
  lines.forEach((line, lineIdx) => {
    let best: { rule: DiscountRule; amount: number } | null = null;
    for (const rule of scheduled) {
      if (!eligible.get(rule.id)?.has(lineIdx)) continue;
      const amount = discountForLine(rule, line);
      if (amount === null || amount <= 0) continue;
      if (
        !best ||
        rule.priority > best.rule.priority ||
        (rule.priority === best.rule.priority && amount > best.amount)
      ) {
        best = { rule, amount };
      }
    }
    if (!best) return;
    evaluatedLines.push({
      productId: line.productId,
      discountId: best.rule.id,
      discountTitle: best.rule.title,
      amount: best.amount,
    });
    const agg = byDiscount.get(best.rule.id) ?? {
      discountId: best.rule.id,
      discountTitle: best.rule.title,
      amount: 0,
    };
    agg.amount = round2(agg.amount + best.amount);
    byDiscount.set(best.rule.id, agg);
  });

  // Per-rule total cap: scale proportionally, fold rounding drift into
  // the largest line so the capped total is exact.
  for (const [discountId, agg] of byDiscount) {
    const rule = ruleById.get(discountId)!;
    if (rule.maxDiscountAmount === null || agg.amount <= rule.maxDiscountAmount) {
      continue;
    }
    const cap = rule.maxDiscountAmount;
    const ruleLines = evaluatedLines.filter((l) => l.discountId === discountId);
    if (cap <= 0) {
      for (const l of ruleLines) l.amount = 0;
      agg.amount = 0;
      continue;
    }
    const factor = cap / agg.amount;
    let scaledSum = 0;
    for (const l of ruleLines) {
      l.amount = round2(l.amount * factor);
      scaledSum = round2(scaledSum + l.amount);
    }
    const drift = round2(cap - scaledSum);
    if (drift !== 0) {
      const largest = ruleLines.reduce((a, b) =>
        b.amount > a.amount ? b : a,
      );
      largest.amount = round2(largest.amount + drift);
    }
    agg.amount = cap;
  }
  const finalLines = evaluatedLines.filter((l) => l.amount > 0);
  const finalByDiscount = [...byDiscount.values()].filter((b) => b.amount > 0);
  const totalDiscount = round2(
    finalLines.reduce((s, l) => s + l.amount, 0),
  );
  return {
    totalDiscount,
    lines: finalLines,
    byDiscount: finalByDiscount,
    skipped,
  };
}
