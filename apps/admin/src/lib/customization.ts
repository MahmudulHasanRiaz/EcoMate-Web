/**
 * Product customization — admin-side shapes mirroring the backend
 * (apps/backend/src/customization/customization.types.ts).
 *
 * The DEFINITION lives on the product; the ANSWER snapshot is frozen on
 * each order item with labels + prices resolved at order time.
 */

export interface CustomizationOptionDef {
  key: string
  label: string
  priceDelta: number
  costDelta: number
  pricingKind: 'per_unit' | 'per_line'
}

export interface CustomizationGroupDef {
  key: string
  label: string
  type: 'single' | 'multi' | 'text'
  required: boolean
  maxLength?: number
  priceDelta?: number
  costDelta?: number
  options?: CustomizationOptionDef[]
}

export interface CustomizationSnapshotGroup {
  key: string
  label: string
  type: 'single' | 'multi' | 'text'
  options: Array<{
    key: string
    label: string
    priceDelta: number
    costDelta: number
    pricingKind: 'per_unit' | 'per_line'
  }>
  text?: string
  priceDelta?: number
  costDelta?: number
}

export interface CustomizationSnapshot {
  groups: CustomizationSnapshotGroup[]
}

/** True when an order item's snapshot carries any actual answer. */
export function hasCustomization(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false
  const groups = (snapshot as CustomizationSnapshot).groups
  if (!Array.isArray(groups)) return false
  return groups.some(
    (g) =>
      (Array.isArray(g?.options) && g.options.length > 0) ||
      (typeof g?.text === 'string' && g.text.trim().length > 0),
  )
}

export function asSnapshot(raw: unknown): CustomizationSnapshot | null {
  if (!hasCustomization(raw)) return null
  return raw as CustomizationSnapshot
}

export interface CustomizationSelection {
  groups: Array<{ key: string; optionKeys?: string[]; text?: string }>
}

/**
 * Converts a frozen snapshot back into the keys-only selection the API
 * accepts — used when an edit form round-trips an existing line. The
 * server re-resolves it against the current definition; identical
 * content is not treated as a change (see the Q19 Packed lock).
 */
export function snapshotToSelection(
  raw: unknown,
): CustomizationSelection | undefined {
  const snap = asSnapshot(raw)
  if (!snap) return undefined
  return {
    groups: snap.groups.map((g) => ({
      key: g.key,
      optionKeys: g.options?.map((o) => o.key),
      text: g.type === 'text' ? g.text : undefined,
    })),
  }
}

/** Line add-on SELL total recomputed from a frozen snapshot (display only). */
export function snapshotAddonTotal(raw: unknown, quantity: number): number {
  const snap = asSnapshot(raw)
  if (!snap) return 0
  let total = 0
  for (const g of snap.groups) {
    if (g.type === 'text') {
      total += g.priceDelta ?? 0
      continue
    }
    for (const o of g.options || []) {
      total += (o.priceDelta ?? 0) * (o.pricingKind === 'per_unit' ? quantity : 1)
    }
  }
  return Math.round((total + Number.EPSILON) * 100) / 100
}

/** Line add-on total for a selection against a definition (display only). */
export function selectionAddonTotal(
  definition: CustomizationGroupDef[] | null | undefined,
  selection: CustomizationSelection | undefined,
  quantity: number,
): number {
  if (!definition?.length || !selection) return 0
  let total = 0
  for (const g of definition) {
    const ans = selection.groups.find((x) => x.key === g.key)
    if (!ans) continue
    if (g.type === 'text') {
      if (ans.text?.trim()) total += g.priceDelta ?? 0
      continue
    }
    for (const key of ans.optionKeys ?? []) {
      const opt = g.options?.find((o) => o.key === key)
      if (opt) total += opt.priceDelta * (opt.pricingKind === 'per_unit' ? quantity : 1)
    }
  }
  return Math.round((total + Number.EPSILON) * 100) / 100
}
