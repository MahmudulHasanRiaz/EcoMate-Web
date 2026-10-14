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

/**
 * Raw snapshot name with NO floor/prefix/truncation: "first last" ||
 * guestName (trimmed, '' when absent). Used to detect whether
 * courierSafeRecipientName transformed the name for the timeline note.
 */
export function orderRecipientRawName(o: OrderRecipientSource): string {
  const full = [o.customerFirstName, o.customerLastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return (full || o.guestName || '').trim();
}

/**
 * Per-courier recipient-name length rules (Fix 5a, owner decision).
 *
 * Doc sources (latest docs, read 2026-10-14):
 * - Pathao: `recipient_name` 3–100 chars (doc-verified).
 * - Steadfast: `recipient_name` "Stored to 100 characters", NO minimum
 *   stated → min 3 assumed (default), max 100 doc-verified.
 * - RedX: `customer_name` — NO lengths stated → 3/100 assumed (default).
 * - Carrybee: `recipient_name`/`customer_name` 2–99 chars (doc-verified).
 *   Carrybee is EXEMPT from the Mx. prefix by owner decision — short names
 *   go out verbatim (only trimmed + truncated to 99).
 *
 * Rules: empty → '' (no prefix; the CALLER surfaces a field error).
 * Short (< min, non-empty, non-Carrybee) → `'Mx. ' + full` (gender-neutral,
 * owner-locked). Long (> max) → truncated to max. The stored order/customer
 * is NEVER mutated — this is a pure function; only the dispatch payload +
 * dispatch record carry the transformed value.
 */
export function courierSafeRecipientName(
  o: OrderRecipientSource,
  courier: string,
): string {
  const full = orderRecipientRawName(o);
  if (!full) return '';
  const c = (courier || '').toLowerCase();
  if (c === 'carrybee') {
    return full.length > 99 ? full.slice(0, 99) : full;
  }
  // max: pathao 100 + steadfast 100 doc-verified; redx/unknown default 100.
  const max = 100;
  if (full.length > max) return full.slice(0, max);
  // min: pathao 3 doc-verified; steadfast/redx unstated → default 3 assumed.
  const min = 3;
  if (full.length < min) return `Mx. ${full}`;
  return full;
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
