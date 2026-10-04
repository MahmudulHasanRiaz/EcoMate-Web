/**
 * Client-side mirror of the backend item-edit status gate
 * (apps/backend/src/orders/order-transitions.ts — ITEM_EDIT_BLOCKED_STATUSES /
 * ITEM_EDIT_WARNING_STATUSES).
 *
 * The API is always the authority; these lists exist only so the edit page can
 * avoid rendering controls that would be rejected. Keep the two in sync — a
 * backend-only change makes the UI stale, not unsafe.
 */

/** Once here, line items can no longer be added, changed or removed. */
export const ITEM_EDIT_BLOCKED_STATUSES: readonly string[] = [
  'Shipping',
  'Delivered',
  'Partial',
  'Return Pending',
  'Returned',
  'Damaged',
];

/** Editable, but the goods are already picked / being packed — warn first. */
export const ITEM_EDIT_WARNING_STATUSES: readonly string[] = [
  'Packed',
  'Packing Hold',
];

export function itemsEditableInStatus(statusName?: string | null): boolean {
  if (!statusName) return true;
  return !ITEM_EDIT_BLOCKED_STATUSES.includes(statusName);
}

export function itemsNeedWarningInStatus(statusName?: string | null): boolean {
  if (!statusName) return false;
  return ITEM_EDIT_WARNING_STATUSES.includes(statusName);
}