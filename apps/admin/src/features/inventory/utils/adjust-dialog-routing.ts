/**
 * Stock page Adjust routing (audit finding C): the dialog is chosen BY TAB,
 * never one shared physical-wired dialog for both views.
 * - Managed tab  → the managed dialog (records the managed quantity;
 *   no warehouse, no unit cost; works with inventory management OFF).
 * - Physical tab → the physical dialog (adjusts the physical inventory
 *   record; warehouse required, unit cost required when adding stock).
 */

export type StockViewMode = 'MANAGED' | 'PHYSICAL'
export type AdjustDialogKind = 'managed' | 'physical'

export function adjustDialogKindForViewMode(viewMode: StockViewMode): AdjustDialogKind {
  return viewMode === 'MANAGED' ? 'managed' : 'physical'
}

/** Title of the managed dialog — states it records the MANAGED quantity. */
export const MANAGED_ADJUST_TITLE = 'Adjust Managed Stock'

/** Title of the physical dialog — states it adjusts the PHYSICAL record. */
export function physicalAdjustTitle(productName?: string | null): string {
  return productName ? `Adjust Physical Stock: ${productName}` : 'Adjust Physical Stock'
}
