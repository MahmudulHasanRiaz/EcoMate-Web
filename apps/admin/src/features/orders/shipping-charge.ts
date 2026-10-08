/**
 * Admin order-form delivery-charge helpers.
 *
 * `resolveCityCharge` mirrors the backend derive step for a city name so the
 * create form can suggest the configured amount. `shouldAutoFillCharge` guards
 * the auto-fill effect: the suggestion refills when the STAFF picks another
 * city, but a background refetch (new array identities for the same city)
 * must never wipe a staff-typed custom rate.
 */

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

  const zones = shippingZones || [];
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
