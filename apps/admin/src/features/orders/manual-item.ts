/**
 * Manual order item helpers (owner 2026-11-11, Workstream C).
 *
 * A manual line is a product-less order line staff add from the Admin
 * order create/edit forms and the order detail page's item editor:
 * a staff-typed name, a quantity, a unit price, and an optional unit
 * cost ("Cost (optional — for profit calculation)"). The backend freezes
 * the cost at write time — cost given → costType 'actual'; cost blank →
 * costSnapshot = price with costType 'not_set' (COGS = full price, profit
 * contribution 0, "cost not set" flag). These helpers are the single
 * place the admin builds manual cart lines and serializes them back to
 * the API payload, so create, edit and detail can never drift.
 */

export interface ManualFormValues {
  name: string
  quantity: string
  price: string
  cost: string
}

export const EMPTY_MANUAL_FORM: ManualFormValues = {
  name: '',
  quantity: '1',
  price: '',
  cost: '',
}

/** Returns an error message, or null when the form is submittable. */
export function validateManualForm(v: ManualFormValues): string | null {
  if (!v.name.trim()) return 'Enter a name for the manual item'
  const qty = Number(v.quantity)
  if (!Number.isInteger(qty) || qty <= 0)
    return 'Quantity must be a whole number greater than 0'
  if (v.price.trim() === '' || !(Number(v.price) >= 0))
    return 'Enter a unit price (0 or more)'
  if (v.cost.trim() !== '' && !(Number(v.cost) >= 0))
    return 'Cost cannot be negative'
  return null
}

/** Cart-line shape shared by the create/edit form (create.tsx). */
export function buildManualCartItem(v: ManualFormValues): any {
  const costGiven = v.cost.trim() !== ''
  return {
    isManual: true,
    manualName: v.name.trim(),
    productId: null,
    variantId: null,
    product: { name: v.name.trim(), images: [] },
    variant: null,
    quantity: parseInt(v.quantity as any) || 1,
    price: parseFloat(v.price as any) || 0,
    ...(costGiven ? { cost: parseFloat(v.cost as any) || 0 } : {}),
    costType: costGiven ? 'actual' : 'not_set',
  }
}

/**
 * Rebuild a create/edit cart line from a server order item (edit
 * hydration). The staff-entered cost round-trips through costSnapshot —
 * only an 'actual' line carries one; a 'not_set' line has no cost to send
 * back, so an untouched edit keeps the server-side flag intact.
 */
export function cartItemFromManualOrderItem(i: any): any {
  const hasCost = i.costType === 'actual' && i.costSnapshot != null
  return {
    itemId: i.id,
    isManual: true,
    manualName: i.manualName ?? '',
    productId: null,
    variantId: null,
    product: { name: i.manualName || 'Manual item', images: [] },
    variant: null,
    quantity: i.quantity,
    price: Number(i.price),
    ...(hasCost ? { cost: Number(i.costSnapshot) } : {}),
    costType: i.costType ?? undefined,
    costSnapshot: i.costSnapshot != null ? Number(i.costSnapshot) : undefined,
  }
}

/**
 * API payload for one manual line (create, updateOrder items, detail-page
 * save). `cost` is sent only when a real cost is known — never for a
 * 'not_set' line, so the backend re-derives (or preserves) the flag.
 */
export function manualItemPayload(item: any): any {
  const rawCost =
    item.cost !== undefined && item.cost !== null && item.cost !== ''
      ? Number(item.cost)
      : item.costType === 'actual' && item.costSnapshot != null
        ? Number(item.costSnapshot)
        : undefined
  return {
    isManual: true,
    manualName: String(item.manualName ?? '').trim(),
    quantity: parseInt(item.quantity as any) || 1,
    price: parseFloat(item.price as any) || 0,
    ...(rawCost !== undefined && !Number.isNaN(rawCost) ? { cost: rawCost } : {}),
  }
}

/** Display name for any order line: product name, else the manual name. */
export function orderLineName(item: any): string {
  return item?.product?.name || item?.manualName || item?.combo?.name || 'Item'
}

/** True when the line's cost was never set (the P&L/detail flag). */
export function isCostNotSet(item: any): boolean {
  return !!item?.isManual && item?.costType === 'not_set'
}
