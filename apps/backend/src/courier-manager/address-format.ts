/**
 * Shared courier shipping-address formatter (Hotfix 1). Every courier adapter
 * sends the SAME full human-readable address assembled from the order's
 * shippingAddress components — no per-provider duplication, no duplicates, no
 * trailing commas, no fabricated defaults.
 *
 * Component mapping (adapt to whatever the order actually stores):
 *   addressLine / address  -> house / road / area
 *   area                   -> union / ward
 *   thana / upazila        -> upazila / thana
 *   district               -> district
 *   division               -> division
 *   postCode / postal / zip-> postal code
 *   country                -> country
 */
export function formatCourierAddress(
  shippingAddress: Record<string, unknown> | null | undefined,
): string | null {
  if (!shippingAddress || typeof shippingAddress !== 'object') return null;

  const seen = new Set<string>();
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== 'string') return;
    const s = value.trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return; // dedupe exact components
    seen.add(key);
    parts.push(s);
  };

  push(shippingAddress.addressLine || shippingAddress.address);
  push(shippingAddress.area);
  push(shippingAddress.thana || shippingAddress.upazila);
  push(shippingAddress.district);
  push(shippingAddress.division);
  push(shippingAddress.postCode || shippingAddress.postal || shippingAddress.zip);
  push(shippingAddress.country);

  return parts.length > 0 ? parts.join(', ') : null;
}
