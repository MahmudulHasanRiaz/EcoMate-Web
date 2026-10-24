/**
 * D19 — Advanced (automatic) discount evaluation engine.
 *
 * Pure functions, no Nest/Prisma dependency, so the rules are unit-testable
 * in isolation and shared by the storefront evaluate endpoint and the
 * order-creation hook (both must agree to the cent).
 *
 * Rules (also documented on the Discount model):
 * - A rule is ACTIVE when isActive AND now >= startsAt (if set) AND
 *   now <= endsAt (if set — NULL endsAt = open-ended) AND the order
 *   subtotal reaches minOrderAmount (if set).
 * - Scope matching: SITEWIDE matches every line; CATEGORY matches a line
 *   when any of the product's categories falls inside the selected
 *   categories' SUBTREES (children, grandchildren, …); PRODUCT matches
 *   when the product id is listed.
 * - Per line, at most ONE automatic discount applies: the one giving the
 *   largest line discount (ties → the earliest rule in input order, which
 *   the service sorts by createdAt ascending, so oldest wins ties).
 * - percentage: lineTotal * value / 100. flat: value PER UNIT, capped at
 *   the line total (a ৳100 flat discount on a ৳60 line gives ৳60, never a
 *   negative line). Line totals include customization add-on amounts.
 */

export type DiscountScope = 'SITEWIDE' | 'CATEGORY' | 'PRODUCT';
export type DiscountType = 'percentage' | 'flat';

export interface DiscountRule {
  id: string;
  title: string;
  scope: DiscountScope;
  categoryIds: string[];
  productIds: string[];
  type: DiscountType;
  value: number;
  minOrderAmount: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

export interface DiscountLine {
  productId: string;
  categoryIds: string[];
  quantity: number;
  unitPrice: number;
  addonAmount?: number;
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

export interface EvaluationResult {
  totalDiscount: number;
  lines: EvaluatedLine[];
  byDiscount: { discountId: string; discountTitle: string; amount: number }[];
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

export function isDiscountActive(
  rule: DiscountRule,
  subtotal: number,
  now: Date,
): boolean {
  if (!rule.isActive) return false;
  if (rule.startsAt && now < rule.startsAt) return false;
  if (rule.endsAt && now > rule.endsAt) return false;
  if (rule.minOrderAmount !== null && subtotal < rule.minOrderAmount)
    return false;
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
  subtotal: number,
  categories: CategoryNode[],
  now: Date,
): EvaluationResult {
  const active = rules.filter((r) => isDiscountActive(r, subtotal, now));
  const subtreeByRule = new Map<string, Set<string>>();
  for (const rule of active) {
    if (rule.scope === 'CATEGORY') {
      subtreeByRule.set(
        rule.id,
        expandCategorySubtree(categories, rule.categoryIds),
      );
    }
  }
  const matches = (rule: DiscountRule, line: DiscountLine): boolean => {
    if (rule.scope === 'SITEWIDE') return true;
    if (rule.scope === 'PRODUCT') return rule.productIds.includes(line.productId);
    const subtree = subtreeByRule.get(rule.id)!;
    return line.categoryIds.some((c) => subtree.has(c));
  };

  const evaluatedLines: EvaluatedLine[] = [];
  const byDiscount = new Map<
    string,
    { discountId: string; discountTitle: string; amount: number }
  >();
  for (const line of lines) {
    let best: { rule: DiscountRule; amount: number } | null = null;
    for (const rule of active) {
      if (!matches(rule, line)) continue;
      const amount = discountForLine(rule, line);
      if (amount === null || amount <= 0) continue;
      if (!best || amount > best.amount) best = { rule, amount };
    }
    if (!best) continue;
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
  }
  const totalDiscount = round2(
    evaluatedLines.reduce((s, l) => s + l.amount, 0),
  );
  return {
    totalDiscount,
    lines: evaluatedLines,
    byDiscount: [...byDiscount.values()],
  };
}
