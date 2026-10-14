/**
 * Order recipient source of truth (D-A).
 *
 * The order-time customer snapshot (`Order.customerFirstName/LastName/Phone/
 * Email` + `guestName/guestPhone`) is the SOLE live source for dispatch
 * payloads, tracking lookups and order-scoped reads. The linked
 * CustomerProfile is customer-owned mutable data and must never feed these
 * paths — it may still hold pre-correction values after staff fix an order
 * (PUT /orders/:id customerInfo writes the snapshot; the profile write
 * behind it is a separate ownership operation).
 */

export interface OrderRecipientSource {
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
}

/**
 * Full snapshot name: "first last" || guestName || 'Customer'.
 * The result is never shorter than 3 chars — Pathao rejects
 * `recipient_name` outside 3–100 chars, so a short fragment floors to
 * 'Customer' instead of being sent verbatim.
 */
export function orderRecipientName(o: OrderRecipientSource): string {
  const full = [o.customerFirstName, o.customerLastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const name = full || o.guestName || 'Customer';
  return name.length >= 3 ? name : 'Customer';
}

/** Snapshot phone: customerPhone || guestPhone (undefined when neither). */
export function orderRecipientPhone(
  o: OrderRecipientSource,
): string | undefined {
  return o.customerPhone || o.guestPhone || undefined;
}

/** Snapshot email: customerEmail (undefined when absent). */
export function orderRecipientEmail(
  o: OrderRecipientSource,
): string | undefined {
  return o.customerEmail || undefined;
}

export interface OrderSnapshotCustomer {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}

/**
 * GET-shape `customer` built from snapshot fields only (null when the order
 * carries no identity at all). Keeps the legacy keys (name/email/phone +
 * firstName/lastName/phoneNumber) so existing UI keeps working while the
 * source flips to snapshot.
 */
export function orderSnapshotCustomer(
  o: OrderRecipientSource & { customerId?: string | null },
): OrderSnapshotCustomer | null {
  const firstName = o.customerFirstName || '';
  const lastName = o.customerLastName || '';
  const full = [o.customerFirstName, o.customerLastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const name = full || o.guestName || '';
  const phone = o.customerPhone || o.guestPhone || '';
  const email = o.customerEmail || '';
  if (!name && !phone && !email) return null;
  return {
    id: o.customerId ?? null,
    name,
    email,
    phone,
    firstName,
    lastName,
    phoneNumber: phone,
  };
}
