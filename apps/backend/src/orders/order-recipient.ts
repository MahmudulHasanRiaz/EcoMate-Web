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
 *
 * @deprecated Dead floor — use {@link courierSafeRecipientName} for
 * courier-facing names (grapheme-aware Mx. prefix / per-courier max).
 * Kept only for legacy callers; the Pathao ≥3 floor here is NOT
 * grapheme-aware and must not feed dispatch payloads.
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
 * Split a string into user-perceived characters (grapheme clusters).
 * Uses `Intl.Segmenter` (`granularity: 'grapheme'`) when the runtime
 * supports it (Node 16+); falls back to code-point spread otherwise.
 * Pathao counts user-perceived characters: 'জয়' is 3 UTF-16 units / 3
 * code points but 2 graphemes, so it must fail a min-3 check.
 */
export function segmentGraphemes(value: string): string[] {
  const Segmenter = (Intl as unknown as Record<string, unknown>)?.[
    'Segmenter'
  ] as
    | (new (
        locales?: string | string[],
        options?: { granularity?: string },
      ) => { segment(s: string): Iterable<{ segment: string }> })
    | undefined;
  if (typeof Segmenter === 'function') {
    try {
      const seg = new Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(seg.segment(value), (s) => s.segment);
    } catch {
      return [...value];
    }
  }
  return [...value];
}

/** User-perceived character count (grapheme clusters, not UTF-16 units). */
export function graphemeLength(value: string): number {
  return segmentGraphemes(value).length;
}

/** Truncate to `max` graphemes without ever splitting a cluster. */
export function truncateGraphemes(value: string, max: number): string {
  const parts = segmentGraphemes(value);
  return parts.length > max ? parts.slice(0, max).join('') : value;
}

/**
 * Per-courier recipient-name length rules (Fix 5a, owner decision).
 *
 * Lengths are counted in GRAPHEME CLUSTERS (user-perceived characters),
 * not UTF-16 units: Pathao rejects 'জয়' as 2 chars even though
 * `'জয়'.length === 3`. Truncation cuts on cluster boundaries (never
 * splits a combining mark / ZWJ sequence).
 *
 * Doc sources (latest docs, read 2026-10-14):
 * - Pathao: `recipient_name` 3–100 chars (doc-verified).
 * - Steadfast: `recipient_name` "Stored to 100 characters", NO minimum
 *   stated → min 3 assumed (default), max 100 doc-verified.
 * - RedX: `customer_name` — NO lengths stated → 3/100 assumed (default).
 * - Carrybee: `recipient_name`/`customer_name` 2–99 chars (doc-verified).
 *   Carrybee is EXEMPT from the Mx. prefix by owner decision — short names
 *   go out verbatim (only trimmed + truncated to 99 graphemes).
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
    return graphemeLength(full) > 99 ? truncateGraphemes(full, 99) : full;
  }
  // max: pathao 100 + steadfast 100 doc-verified; redx/unknown default 100.
  const max = 100;
  if (graphemeLength(full) > max) return truncateGraphemes(full, max);
  // min: pathao 3 doc-verified; steadfast/redx unstated → default 3 assumed.
  const min = 3;
  if (graphemeLength(full) < min) return `Mx. ${full}`;
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
