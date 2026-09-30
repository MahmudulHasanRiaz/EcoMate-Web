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
