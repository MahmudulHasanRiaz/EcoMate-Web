/**
 * The single source of truth for order-status transitions.
 *
 * Consumed by:
 *  - OrdersService (runtime transition gate)
 *  - prisma/seed.ts (creates the OrderStatus.nextStatuses rows on a fresh DB
 *    ONLY — an existing installation's configured transitions are never
 *    overwritten by a reseed)
 *
 * 'Partial' is automation-stopped AND resolution-stopped: the ONLY legitimate
 * Partial → Delivered path is the RTN return-order creation workflow
 * (RtnService.createFromPartialOrder), which performs it transactionally.
 * Staff can no longer close a Partial order as Delivered in the generic
 * status UI — it must be resolved into a Return Order first.
 * (Migration 20260930010000_rtn_return_orders removes 'Delivered' from
 * OrderStatus."Partial".nextStatuses for existing installs.)
 */
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  Pending: ['Payment Pending', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Pending': ['Payment Verifying', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Verifying': ['Confirmed', 'Hold', 'Cancelled'],
  Hold: ['Pending', 'Confirmed', 'Cancelled'],
  Confirmed: ['Hold', 'Packed', 'Packing Hold', 'Cancelled'],
  Packed: ['Shipping', 'Packing Hold'],
  'Packing Hold': ['Packed', 'Cancelled'],
  Shipping: ['Delivered', 'Partial', 'Return Pending'],
  Delivered: ['Return Pending'],
  Partial: ['Return Pending'],
  'Return Pending': ['Returned', 'Damaged'],
  Returned: ['Damaged'],
  Cancelled: ['Hold', 'Confirmed'],
  Damaged: [],
};

/**
 * Statuses in which an order's LINE ITEMS may no longer be added, changed or
 * removed.
 *
 * Item edits re-reserve stock. Once physical units have left the warehouse
 * (Shipping) or the lifecycle has been financially closed (Delivered,
 * Returned, …) re-reserving produces an inventory figure that never existed,
 * so the endpoints refuse item changes outright. Non-item edits — notes,
 * shipping, payment, customer details — remain available in every status.
 *
 * 'Cancelled' is deliberately absent: cancelling RELEASES the reservation, and
 * the `Cancelled → Hold | Confirmed` transition re-establishes it through the
 * normal status path. A cancelled order that staff revive can therefore be
 * edited like any other.
 */
export const ITEM_EDIT_BLOCKED_STATUSES: ReadonlySet<string> = new Set([
  'Shipping',
  'Delivered',
  'Partial',
  'Return Pending',
  'Returned',
  'Damaged',
]);

/**
 * Statuses where item edits remain possible but the goods have already been
 * picked or are being packed. The API allows the write; the admin surfaces a
 * confirmation banner so a mid-pack correction is never silent.
 */
export const ITEM_EDIT_WARNING_STATUSES: ReadonlySet<string> = new Set([
  'Packed',
  'Packing Hold',
]);
