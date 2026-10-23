/**
 * Product customization — storefront (public) shapes.
 *
 * The definition arrives on the product payload; the SANITIZER strips
 * cost deltas (internal figures never render client-side). Selections
 * are keys/text only — the backend re-resolves every price at order
 * time, so nothing computed here is trusted for money, only for
 * display and cart identity.
 */

export interface PublicCustomizationOption {
  key: string;
  label: string;
  priceDelta: number;
  pricingKind: 'per_unit' | 'per_line';
}

export interface PublicCustomizationGroup {
  key: string;
  label: string;
  type: 'single' | 'multi' | 'text';
  required: boolean;
  maxLength?: number;
  priceDelta?: number;
  options?: PublicCustomizationOption[];
}

export interface CustomizationSelection {
  groups: Array<{ key: string; optionKeys?: string[]; text?: string }>;
}

/** What rides on a cart line: the selection + precomputed display data. */
export interface CartCustomization {
  selection: CustomizationSelection;
  lines: Array<{ label: string; value: string }>;
  addonPerUnit: number;
  addonPerLine: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Defensive parse of the raw product payload; drops cost fields. */
export function sanitizeDefinition(raw: unknown): PublicCustomizationGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicCustomizationGroup[] = [];
  for (const g of raw as any[]) {
    if (!g || typeof g.key !== 'string' || typeof g.label !== 'string') continue;
    const type = g.type === 'multi' || g.type === 'text' ? g.type : 'single';
    const group: PublicCustomizationGroup = {
      key: g.key,
      label: g.label,
      type,
      required: g.required === true,
    };
    if (type === 'text') {
      group.maxLength =
        typeof g.maxLength === 'number' && g.maxLength > 0 ? Math.min(1000, Math.floor(g.maxLength)) : 200;
      group.priceDelta = Math.max(0, Number(g.priceDelta) || 0);
    } else {
      group.options = (Array.isArray(g.options) ? g.options : [])
        .filter((o: any) => o && typeof o.key === 'string' && typeof o.label === 'string')
        .map((o: any) => ({
          key: o.key,
          label: o.label,
          priceDelta: Math.max(0, Number(o.priceDelta) || 0),
          pricingKind: o.pricingKind === 'per_line' ? 'per_line' : 'per_unit',
        }));
    }
    out.push(group);
  }
  return out;
}

export function selectionAddon(
  definition: PublicCustomizationGroup[],
  selection: CustomizationSelection | undefined,
): { perUnit: number; perLine: number } {
  let perUnit = 0;
  let perLine = 0;
  if (!selection) return { perUnit, perLine };
  for (const g of definition) {
    const ans = selection.groups.find((x) => x.key === g.key);
    if (!ans) continue;
    if (g.type === 'text') {
      if (ans.text?.trim()) perLine += g.priceDelta ?? 0;
      continue;
    }
    for (const key of ans.optionKeys ?? []) {
      const opt = g.options?.find((o) => o.key === key);
      if (!opt) continue;
      if (opt.pricingKind === 'per_unit') perUnit += opt.priceDelta;
      else perLine += opt.priceDelta;
    }
  }
  return { perUnit: round2(perUnit), perLine: round2(perLine) };
}

/** Builds the cart payload, or null when nothing was actually chosen. */
export function buildCartCustomization(
  definition: PublicCustomizationGroup[],
  selection: CustomizationSelection | undefined,
): CartCustomization | null {
  if (!selection) return null;
  const lines: Array<{ label: string; value: string }> = [];
  for (const g of definition) {
    const ans = selection.groups.find((x) => x.key === g.key);
    if (!ans) continue;
    if (g.type === 'text') {
      const text = ans.text?.trim();
      if (text) lines.push({ label: g.label, value: text });
      continue;
    }
    const labels = (ans.optionKeys ?? [])
      .map((k) => g.options?.find((o) => o.key === k)?.label)
      .filter(Boolean) as string[];
    if (labels.length > 0) lines.push({ label: g.label, value: labels.join(', ') });
  }
  if (lines.length === 0) return null;
  const { perUnit, perLine } = selectionAddon(definition, selection);
  return { selection, lines, addonPerUnit: perUnit, addonPerLine: perLine };
}

/** Labels of required groups with no answer — blocks add-to-cart. */
export function missingRequiredGroups(
  definition: PublicCustomizationGroup[],
  selection: CustomizationSelection | undefined,
): string[] {
  const missing: string[] = [];
  for (const g of definition) {
    if (!g.required) continue;
    const ans = selection?.groups.find((x) => x.key === g.key);
    const answered =
      g.type === 'text'
        ? !!ans?.text?.trim()
        : (ans?.optionKeys?.length ?? 0) > 0;
    if (!answered) missing.push(g.label);
  }
  return missing;
}

/** Stable cart-identity fragment for a selection. */
export function selectionKey(selection: CustomizationSelection): string {
  const parts = [...selection.groups]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((g) => {
      const opts = [...(g.optionKeys ?? [])].sort().join(',');
      return `${g.key}[${opts}]${g.text ? `="${g.text.trim()}"` : ''}`;
    });
  return parts.join('|');
}

/** Full line total for a cart item, customization add-ons included. */
export function cartLineTotal(item: {
  price: number;
  quantity: number;
  customization?: CartCustomization | null;
}): number {
  const perUnit = item.customization?.addonPerUnit ?? 0;
  const perLine = item.customization?.addonPerLine ?? 0;
  return round2((item.price + perUnit) * item.quantity + perLine);
}
