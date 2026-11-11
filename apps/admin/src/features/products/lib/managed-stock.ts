/**
 * Managed-stock helpers for the stock-mode round (audit findings B–E).
 *
 * Managed stock is edited ONLY from the Products list and the Stock page's
 * Managed tab, and only for products whose availabilityMode is
 * MANAGED_STOCK. These pure helpers hold that rule in one place so the
 * modal search, the selection bar and the product form's mode-switch note
 * cannot drift apart.
 */

export const MANAGED_STOCK_MODE = 'MANAGED_STOCK'

export function isManagedStockProduct(
  product: { availabilityMode?: string | null } | null | undefined,
): boolean {
  return product?.availabilityMode === MANAGED_STOCK_MODE
}

/**
 * A product the managed-adjust modal can actually adjust: managed mode AND
 * not a combo-type product. Combo-type rows are EXCLUDED (review decision):
 * the modal has no combo picker and cannot wire the backend's `comboId`
 * path — that DTO field addresses the separate Combo ENTITY (its own
 * table/id space, adjusting a combo fans out to its component products),
 * while a combo-type Product row's id is a Product id, so sending it as
 * `comboId` would 404 ("Combo not found") and sending it as `productId`
 * would write the combo row's own managedStockQuantity, which the backend
 * itself treats as not stock-bearing for combo-type products (update()
 * strips managedStockQuantity/manageStock for variable AND combo types,
 * exactly like variable products whose stock lives on variants). Combo
 * stock is component-derived, so no managed-adjust entry is offered.
 */
export function isManagedAdjustableProduct(
  product:
    | { availabilityMode?: string | null; type?: string | null }
    | null
    | undefined,
): boolean {
  return isManagedStockProduct(product) && product?.type !== 'combo'
}

/**
 * Keep only managed-adjustable products. The GET /products list payload
 * carries the full product row (backend `listInclude` includes every
 * scalar), so `availabilityMode` is present on each result and the filter
 * can run client-side — the list endpoint has no availabilityMode query
 * param.
 */
export function filterManagedStockProducts<
  T extends { availabilityMode?: string | null; type?: string | null },
>(products: T[]): T[] {
  return products.filter((p) => isManagedAdjustableProduct(p))
}

export interface SavedManagedQuantity {
  /** Human label: product name (simple) or variant attributes (variable). */
  label: string
  sku?: string
  quantity: number
}

/**
 * The CURRENT SAVED managed quantities of a product, for the mode-switch
 * inline note. Reads only the loaded product record — never form state —
 * so quantities the staff typed into the form cannot leak into the note.
 * Variable products list EVERY variant, including 0 / negative quantities.
 */
export function savedManagedQuantities(
  product:
    | {
        name?: string | null
        type?: string | null
        managedStockQuantity?: number | null
        variants?: Array<{
          sku?: string | null
          managedStockQuantity?: number | null
          attributeValues?: Array<{ attributeValue?: { value?: string | null } | null } | null>
        }> | null
      }
    | null
    | undefined,
): SavedManagedQuantity[] {
  if (!product) return []
  const variants = product.variants ?? []
  if (product.type === 'variable' || variants.length > 0) {
    return variants.map((v) => {
      const attrs = (v.attributeValues ?? [])
        .map((av) => av?.attributeValue?.value)
        .filter(Boolean)
        .join(' / ')
      return {
        label: attrs || v.sku || 'Variant',
        sku: v.sku ?? undefined,
        quantity: v.managedStockQuantity ?? 0,
      }
    })
  }
  return [
    {
      label: product.name || 'Product',
      quantity: product.managedStockQuantity ?? 0,
    },
  ]
}

/**
 * Apply gate for the managed adjustment modal: a product must be chosen,
 * the quantity must be a non-zero number, and for a VARIABLE product a
 * variant is REQUIRED (an adjustment never lands on the parent row).
 */
export function canApplyManagedAdjustment(args: {
  productId?: string | null
  quantity: string
  isVariable: boolean
  variantId?: string | null
  /**
   * The selected product's availability mode AS LOADED by the modal's
   * detail fetch. When the caller supplies this field at all (the modal
   * always does — `null` until the fetch for the CURRENT product lands),
   * Apply requires it to be exactly MANAGED_STOCK: a pre-filled
   * non-managed product (Products-list / Stock-page pre-fill bypasses the
   * mode-filtered search) and a not-yet-loaded product both stay blocked,
   * instead of relying on a submit-time toast after the fact. Omitting
   * the field keeps the legacy gate for callers that have no loaded mode.
   */
  availabilityMode?: string | null
}): boolean {
  if (!args.productId) return false
  if (
    args.availabilityMode !== undefined &&
    args.availabilityMode !== MANAGED_STOCK_MODE
  ) {
    return false
  }
  const qty = parseInt(args.quantity)
  if (args.quantity === '' || isNaN(qty) || qty === 0) return false
  if (args.isVariable && !args.variantId) return false
  return true
}

/**
 * The mode-switch note appears only for an EXISTING product whose SAVED
 * mode is MANAGED_STOCK and whose form mode has been changed AWAY from it.
 * New products and untouched modes never show it.
 */
export function shouldShowModeSwitchClearNote(args: {
  isExisting: boolean
  savedMode?: string | null
  currentMode?: string | null
}): boolean {
  return (
    args.isExisting &&
    args.savedMode === MANAGED_STOCK_MODE &&
    !!args.currentMode &&
    args.currentMode !== MANAGED_STOCK_MODE
  )
}
