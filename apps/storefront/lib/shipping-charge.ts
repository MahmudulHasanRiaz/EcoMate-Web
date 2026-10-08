/**
 * Checkout delivery-charge resolution (single source of truth).
 *
 * Mirrors the backend derive step (orders.service.ts `create`) so the bill the
 * customer sees is the bill that gets persisted:
 * - `options` mode: selected option, else auto-fallback to the highest amount.
 * - `auto_district` mode: district with a zone/map rule → that rule's charge;
 *   no district, or a district with no rule → the MAXIMUM configured charge
 *   (default, zone custom_amounts, district_charges values).
 * - Free-delivery threshold applies ONLY when configured (> 0). An unset (0)
 *   minimum must never zero the charge — `subtotal >= 0` is always true.
 */
export interface ShippingOptionLike {
  id: string;
  amount: number | string;
}

export interface ShippingZoneLike {
  districts: string[];
  type: string;
  amount?: number | string | null;
}

export interface DeliveryChargeInput {
  shippingMode: string;
  shippingOptions?: ShippingOptionLike[];
  selectedShippingOptionId?: string | null;
  district?: string;
  shippingZones?: ShippingZoneLike[];
  districtCharges?: Record<string, number> | null;
  defaultCharge: number;
  freeDeliveryMin?: number | null;
  subtotal: number;
}

export interface DeliveryChargeResult {
  charge: number;
  /** Set when the district cannot be delivered to — checkout must block. */
  noDeliveryError: string;
}

export function resolveDeliveryCharge(input: DeliveryChargeInput): DeliveryChargeResult {
  const {
    shippingMode,
    shippingOptions = [],
    selectedShippingOptionId,
    district,
    shippingZones = [],
    districtCharges = null,
    defaultCharge,
    freeDeliveryMin = 0,
    subtotal,
  } = input;

  if (shippingMode === 'options') {
    if (selectedShippingOptionId) {
      const opt = shippingOptions.find((o) => o.id === selectedShippingOptionId);
      return { charge: Number(opt?.amount ?? 0), noDeliveryError: '' };
    }
    if (shippingOptions.length > 0) {
      const highest = [...shippingOptions].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
      return { charge: Number(highest.amount), noDeliveryError: '' };
    }
    return { charge: 0, noDeliveryError: '' };
  }

  const maxCharge = maxConfiguredCharge(defaultCharge, shippingZones, districtCharges);
  const baseCharge = Number(defaultCharge) || 0;

  let charge: number;
  if (!district) {
    charge = maxCharge;
  } else {
    // A matched zone decides alone (map is consulted only with no zone match).
    const zoneGroup = shippingZones.find((z) => z.districts.includes(district));
    if (zoneGroup?.type === 'no_delivery') {
      return { charge: 0, noDeliveryError: 'এই এলাকায় ডেলিভারি সম্ভব না' };
    }
    if (zoneGroup) {
      charge =
        zoneGroup.type === 'custom_amount' && zoneGroup.amount != null
          ? Number(zoneGroup.amount) || 0
          : baseCharge;
    } else if (districtCharges && districtCharges[district] !== undefined) {
      charge = Number(districtCharges[district]) || 0;
    } else {
      charge = maxCharge;
    }
  }
  if (Number(freeDeliveryMin) > 0 && subtotal >= Number(freeDeliveryMin)) {
    charge = 0;
  }
  return { charge, noDeliveryError: '' };
}

/** Maximum across every configured charge: default, zone custom_amounts, map. */
export function maxConfiguredCharge(
  defaultCharge: number,
  shippingZones: ShippingZoneLike[] = [],
  districtCharges: Record<string, number> | null = null,
): number {
  let max = Number(defaultCharge) || 0;
  for (const z of shippingZones) {
    if (z.type === 'custom_amount' && z.amount != null) {
      max = Math.max(max, Number(z.amount) || 0);
    }
  }
  for (const v of Object.values(districtCharges || {})) {
    max = Math.max(max, Number(v) || 0);
  }
  return max;
}
