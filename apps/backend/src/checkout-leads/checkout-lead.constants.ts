/**
 * Checkout-lead lifecycle statuses (documented; CRM-compatible, design 2026-08-02).
 *
 * Lifecycle:
 *   PENDING
 *     → CONVERTED     Manual recovery: admin/staff followed up and created an
 *                     order via convertToOrder (or updateStatus CONVERTED).
 *     → SUPERSEDED    Customer self-purchase: the customer successfully placed
 *                     an order on their own (same session ctxId, or same phone
 *                     per the customer-level follow-up rule). NOT a conversion.
 *     → NOT_CONVERTED Dismissed / expired: no follow-up, did not convert.
 *
 * Semantics of SUPERSEDED:
 *   "No further follow-up is needed because the customer has already made a
 *   successful order another way." It is neither a Conversion nor a Failure.
 *   It must NEVER be counted in any Lead-Conversion or Sales-Conversion metric.
 *   convertToOrder is the ONLY path that marks a lead CONVERTED; a self-purchase
 *   closes matching PENDING leads to SUPERSEDED silently (no convertedOrderId,
 *   no convertedAt, no conversion tracking event).
 */
export const LEAD_STATUS = {
  PENDING: 'PENDING',
  CONVERTED: 'CONVERTED',
  SUPERSEDED: 'SUPERSEDED',
  NOT_CONVERTED: 'NOT_CONVERTED', // "dismissed / expired"
  DELETED: 'DELETED',
} as const;

export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

/** Statuses that are still actionable in the sales follow-up queue. */
export const ACTIVE_LEAD_STATUSES: readonly string[] = [LEAD_STATUS.PENDING];
