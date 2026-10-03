import { normalizePhone } from '../common/utils/phone-utils';
import { extractScanIdentifier } from '../scanner/scanner-resolver';

/** Digits, optional leading `+`, and the separators people paste. Nothing else. */
const PHONE_SHAPED = /^[+\d][\d\s()+-]*$/;

/**
 * Every spelling a Bangladesh mobile number can be stored in, derived from its
 * canonical E.164 form. Order.guestPhone and CustomerProfile.phone are written
 * normalized (`+8801…`), but rows predating that invariant — imports, manual
 * SQL, older seeds — may hold the national (`01…`) or bare (`8801…`) form.
 * Equality against all four spellings keeps the lookup exact AND index-usable
 * (CustomerProfile.phone is unique, Order.guestPhone is indexed); a `contains`
 * would degrade to a sequential scan.
 */
export function phoneSpellings(e164: string): string[] {
  const digits = e164.replace(/\D/g, ''); // 8801XXXXXXXXX
  const national = digits.slice(3); // 1XXXXXXXXX
  return [`+${digits}`, digits, `0${national}`, national];
}

/**
 * Build the OR-set the orders list searches with. One input field covers every
 * identifier a staff member may paste:
 *
 * - order number — free substring, so partial IDs work (`260929`, `0013`)
 * - customer name / guest name — free substring
 * - product SKU (product or variant) — matched through an EXISTS subquery
 *   (`items.some`), so an order with three matching lines still appears once
 * - phone — when the input satisfies the storefront/Dhaka 11-digit rule it is
 *   normalized and matched EXACTLY, so `01712121213`, `8801712121213`,
 *   `+8801712121213` and `1712121213` all find the same rows regardless of how
 *   they were stored. Anything that is not yet a full number (progressive
 *   typing) falls back to a digits-only substring so both the national and the
 *   international spelling still hit.
 *
 * Returns `undefined` for a blank search so callers can skip the OR entirely.
 */
export function buildOrderSearchFilter(
  search?: string | null,
): { OR: any[] } | undefined {
  const raw = (search || '').trim();
  if (!raw) return undefined;
  const q = extractScanIdentifier(raw);

  const or: any[] = [
    { displayId: { contains: q, mode: 'insensitive' } },
    // RTN orders are found by their own RTN- number (above) AND by the
    // original ORD- number they were created from.
    { returnOfOrder: { displayId: { contains: q, mode: 'insensitive' } } },
    // Associated dispatch identifiers (consignment / tracking code).
    { courierConsignmentId: { contains: q, mode: 'insensitive' } },
    { courierTrackingCode: { contains: q, mode: 'insensitive' } },
    { customer: { name: { contains: q, mode: 'insensitive' } } },
    { guestName: { contains: q, mode: 'insensitive' } },
    {
      items: {
        some: {
          OR: [
            { variant: { sku: { contains: q, mode: 'insensitive' } } },
            { product: { sku: { contains: q, mode: 'insensitive' } } },
          ],
        },
      },
    },
  ];

  const e164 = normalizePhone(q);
  if (e164) {
    const spellings = phoneSpellings(e164);
    or.push({ customer: { phone: { in: spellings } } });
    or.push({ guestPhone: { in: spellings } });
    return { OR: or };
  }

  // Not a complete number: match the digit core (leading trunk 0 dropped) so a
  // half-typed number still narrows, in either storage spelling. Only for input
  // that is shaped like a phone number — an order-id fragment such as
  // `ORD-260929` must not fan out into phone substring matching.
  if (!PHONE_SHAPED.test(q)) return { OR: or };

  const digits = q.replace(/\D/g, '');
  const core = digits.startsWith('0') ? digits.slice(1) : digits;
  if (core.length >= 3) {
    or.push({ customer: { phone: { contains: core } } });
    or.push({ guestPhone: { contains: core } });
  }

  return { OR: or };
}
