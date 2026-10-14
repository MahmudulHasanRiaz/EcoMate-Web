// Dispatch statuses that prove the parcel was picked up (or beyond).
// Dashboard "Picked Up" KPI is driven by Dispatch.pickedUpAt + timeline
// PICKED_UP events — courier paths often skip the explicit PICKED_UP
// transition (HOLD → IN_TRANSIT, missed pickup webhook → order.in-transit,
// sync mapping straight to DELIVERED). Any status at-or-past physical
// possession must still stamp the pickup KPI timestamp (first write wins).
// RETURN_PENDING / RETURNED also imply pickup: a parcel cannot come back
// to the merchant without first leaving for the courier.
// Task 3 (owner-locked F7): ASSIGNED_TO_HUB implies pickup (a parcel at the
// last-mile hub was necessarily picked up); PICKUP_FAILED explicitly does
// NOT (the pickup never happened) and stays out of this set.
const PICKUP_IMPLIED_STATUSES = new Set([
  'PICKED_UP',
  'IN_TRANSIT',
  'ASSIGNED_TO_HUB',
  'ASSIGNED_TO_RIDER',
  'DELIVERED',
  'PARTIAL',
  'RETURN_PENDING',
  'RETURNED',
]);

export function impliesPickup(status: string | null | undefined): boolean {
  return !!status && PICKUP_IMPLIED_STATUSES.has(status);
}
