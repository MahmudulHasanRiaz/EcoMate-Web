/**
 * Product customization — shared types (owner decisions 2026-10-23,
 * Q14–Q20; license feature key 'product-customization').
 *
 * Two layers (design: ~/workspace/your_files/
 * ecomate-web-product-customization-design.md):
 *
 * 1. DEFINITION — admin-defined on the product, stored as
 *    `Product.customizations` JSON. Groups of options (single/multi
 *    choice) or free-text fields (engraving text). Every option carries
 *    BOTH a sell price delta and a cost delta (Q15) and a pricing kind:
 *    'per_unit' multiplies by the line quantity, 'per_line' applies once.
 *
 * 2. ANSWER — the customer's selection, sent per order item as
 *    `CustomizationSelection`, validated + priced SERVER-SIDE against the
 *    product's current definition, and frozen into
 *    `OrderItem.customization` as a `CustomizationSnapshot` (labels,
 *    prices and costs resolved at order time — later definition edits
 *    never rewrite an existing order's invoice or profit).
 */

export type CustomizationGroupType = 'single' | 'multi' | 'text';

export interface CustomizationOption {
  key: string;
  label: string;
  /** Extra SELL price added for this option (BDT). */
  priceDelta: number;
  /** Extra COST added for this option (BDT) — flows into P&L (Q15). */
  costDelta: number;
  /** 'per_unit' → × line quantity; 'per_line' → once per line. */
  pricingKind: 'per_unit' | 'per_line';
}

export interface CustomizationGroup {
  key: string;
  label: string;
  type: CustomizationGroupType;
  required: boolean;
  /** text groups only: max characters of the customer's text. */
  maxLength?: number;
  /** text groups only: flat extra sell price when text is provided. */
  priceDelta?: number;
  /** text groups only: flat extra cost when text is provided. */
  costDelta?: number;
  /** single/multi groups only. */
  options?: CustomizationOption[];
}

/** What the client sends per order item (never prices — keys only). */
export interface CustomizationSelectionGroup {
  key: string;
  optionKeys?: string[];
  text?: string;
}

export interface CustomizationSelection {
  groups: CustomizationSelectionGroup[];
}

/** One resolved group inside the frozen snapshot. */
export interface CustomizationSnapshotOption {
  key: string;
  label: string;
  priceDelta: number;
  costDelta: number;
  pricingKind: 'per_unit' | 'per_line';
}

export interface CustomizationSnapshotGroup {
  key: string;
  label: string;
  type: CustomizationGroupType;
  options: CustomizationSnapshotOption[];
  /** text groups: the customer's text (invoice-only, Q16). */
  text?: string;
  /** text groups: the flat deltas that were applied. */
  priceDelta?: number;
  costDelta?: number;
}

export interface CustomizationSnapshot {
  groups: CustomizationSnapshotGroup[];
}

/** True when a stored OrderItem.customization snapshot carries any answer. */
export function hasCustomization(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const groups = (snapshot as CustomizationSnapshot).groups;
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (g) =>
      (Array.isArray(g?.options) && g.options.length > 0) ||
      (typeof g?.text === 'string' && g.text.trim().length > 0),
  );
}
