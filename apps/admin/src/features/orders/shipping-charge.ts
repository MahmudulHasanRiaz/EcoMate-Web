/**
 * Admin order-form delivery-charge helpers.
 *
 * `resolveCityCharge` mirrors the backend derive step for a city name so the
 * create form can suggest the configured amount. `shouldAutoFillCharge` guards
 * the auto-fill effect: the suggestion refills when the STAFF picks another
 * city, but a background refetch (new array identities for the same city)
 * must never wipe a staff-typed custom rate.
 */

export type ShippingZoneGroup = {
  isActive?: boolean;
  districts?: unknown;
  type?: string;
  amount?: number | string | null;
};

/**
 * Coerce a `GET /shipping/zones` body to the zone-group array the page needs.
 *
 * The endpoint returns a bare array today, but the old query did
 * `(r.data as any[]) || []` — a truthy envelope object passed straight
 * through, and `resolveCityCharge` then threw on the non-array. Accept a bare
 * array, a `{zones: [...]}` envelope, or a `{data: [...]}` envelope; anything
 * else is an empty list, never a crash.
 */
export function normalizeShippingZones(body: unknown): ShippingZoneGroup[] {
  if (Array.isArray(body)) return body as ShippingZoneGroup[];
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.zones)) return b.zones as ShippingZoneGroup[];
    if (Array.isArray(b.data)) return b.data as ShippingZoneGroup[];
  }
  return [];
}

export function resolveCityCharge(
  cityName: string,
  sysSettings: Record<string, unknown> | undefined | null,
  shippingZones: Array<{
    isActive?: boolean;
    districts?: unknown;
    type?: string;
    amount?: number | string | null;
  }> | undefined | null,
  fallback = 60,
): number {
  let defaultCharge = fallback;
  const settingsCharge = Number((sysSettings as any)?.['delivery_charge']);
  if (settingsCharge) defaultCharge = settingsCharge;

  // Defense in depth: a non-array value (e.g. an envelope object passed in
  // by an un-normalised caller) must fall back to the default charge, never
  // throw `zones.find is not a function` on the order-create page.
  const zones = Array.isArray(shippingZones) ? shippingZones : [];
  const raw = (sysSettings as any)?.['district_charges'];
  let districtMap: Record<string, number> = {};
  try {
    const dc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (dc && typeof dc === 'object') districtMap = dc;
  } catch {
    // ignore JSON parse error — keep the default
  }

  // Maximum across every configured charge (same rule as checkout/backend:
  // no applicable rule → max, never silently cheap).
  let maxCharge = defaultCharge;
  for (const z of zones) {
    if ((z as any).type === 'custom_amount' && (z as any).amount != null) {
      maxCharge = Math.max(maxCharge, Number((z as any).amount) || 0);
    }
  }
  for (const v of Object.values(districtMap)) {
    maxCharge = Math.max(maxCharge, Number(v) || 0);
  }

  const name = (cityName || '').trim();
  const matchingZone = zones.find(
    (z: any) =>
      z.isActive !== false &&
      Array.isArray(z.districts) &&
      z.districts.some((d: string) => String(d).toLowerCase() === name.toLowerCase()),
  );

  if (matchingZone) {
    if ((matchingZone as any).type === 'free_delivery') return 0;
    if ((matchingZone as any).type === 'custom_amount' && (matchingZone as any).amount != null) {
      return Number((matchingZone as any).amount);
    }
    return defaultCharge;
  }
  if (districtMap[name] !== undefined) return Number(districtMap[name]);
  return maxCharge;
}

export function shouldAutoFillCharge(args: {
  isPrefilled: boolean;
  activeCityId: string;
  lastAutoCityId: string | null;
  manuallyEdited: boolean;
}): boolean {
  if (args.isPrefilled || !args.activeCityId) return false;
  // Same city, new data (background refetch) + staff-typed rate → keep staff.
  if (args.manuallyEdited && args.lastAutoCityId === args.activeCityId) return false;
  return true;
}
