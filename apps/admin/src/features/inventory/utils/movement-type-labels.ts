/**
 * Centralized type labels for inventory movement types.
 * Covers both Physical Inventory (PI) and Managed Stock Ledger types.
 */
export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  // Physical Inventory types
  PHYSICAL_ADJUSTMENT: 'Physical Adjustment',
  TRANSFER_OUT: 'Transfer Out',
  TRANSFER_IN: 'Transfer In',
  purchase_receive: 'Purchase Receive',
  order_fulfilled: 'Order Fulfilled',
  DEDUCTION: 'Deduction',

  // Managed Stock Ledger types
  INITIAL: 'Initial Balance',
  ORDER_DEDUCTION: 'Order Deduction',
  MANUAL_ADD: 'Manual Add',
  MANUAL_REMOVE: 'Manual Remove',
  ADJUSTMENT: 'Adjustment',
  RETURN: 'Return',
  CANCEL_RELEASE: 'Cancel Release',

  // Inventory Log types (legacy)
  manual_adjustment: 'Adjustment',
  refund_restock: 'Refund Restock',
  cancellation_restock: 'Cancellation Restock',
  transfer: 'Transfer',
  purchase_receive: 'Purchase Receive',
  order_fulfilled: 'Order Fulfilled',
}

/**
 * Badge color variant for movement types.
 */
export function getMovementTypeBadgeVariant(
  type: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (type.includes('OUT') || type.includes('DEDUCTION') || type === 'ORDER_DEDUCTION' || type === 'MANUAL_REMOVE') {
    return 'destructive'
  }
  if (type.includes('IN') || type === 'MANUAL_ADD' || type === 'INITIAL' || type === 'RETURN') {
    return 'default'
  }
  if (type === 'TRANSFER' || type === 'transfer') {
    return 'secondary'
  }
  return 'outline'
}
