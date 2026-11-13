import { MapPin, Truck, CheckCircle, Gift, Package } from "lucide-react";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { serverFetch } from "@/lib/api-server";
import { resolveDeliveryCharge } from "@/lib/shipping-charge";
import DistrictChargeLookup from "./delivery-areas-lookup";

interface DeliveryAreaZone {
  zone?: string;
  charge?: string;
  deliveryTime?: string;
  areas?: string[];
}

interface DistrictRow {
  name: string;
  nameBn?: string;
}

/**
 * Delivery areas, wired to the REAL shipping config (D6) — the same
 * values checkout uses, resolved by the same function
 * (`lib/shipping-charge.ts` `resolveDeliveryCharge`).
 *
 * This resolves the old Free-vs-৳60 contradiction: neither CMS default
 * was the truth. The charge for a district is whatever the checkout
 * resolver returns for it — zone custom_amount, district_charges map,
 * or the `delivery_charge` setting (free only above the
 * `free_delivery_min` threshold). The CMS `areas` array is kept ONLY as
 * a fallback when the config fetch itself fails; it is never the source
 * of a charge claim while the real config is reachable.
 *
 * What the real config does NOT carry: delivery timeframes. Zones have
 * no ETA field, so this page no longer prints "24-48 hours" style
 * claims — inventing them would be a new fake.
 */
export default async function DeliveryAreasTemplate({ config }: { config: Record<string, any> }) {
  const legacyAreas: DeliveryAreaZone[] = Array.isArray(config.areas) ? config.areas : [];
  const legacyFreeMin = Number(config.freeDeliveryMin) || 0;

  let storefrontConfig: Awaited<ReturnType<typeof getStorefrontConfigServer>> | null = null;
  let districts: DistrictRow[] = [];
  try {
    storefrontConfig = await getStorefrontConfigServer();
  } catch {
    storefrontConfig = null;
  }
  try {
    const rows = await serverFetch<DistrictRow[]>("/delivery-areas/districts", {
      next: { revalidate: 3600 },
    });
    if (Array.isArray(rows)) districts = rows;
  } catch {
    districts = [];
  }

  const symbol = storefrontConfig?.currency?.symbol || "৳";
  const freeDeliveryMin = storefrontConfig ? Number(storefrontConfig.delivery?.freeDeliveryMin) || 0 : legacyFreeMin;

  // Config reachable and meaningful? A store with no zones, no district
  // map, no options and a zero default charge has nothing real to show.
  const zones = storefrontConfig?.shippingZones || [];
  const districtCharges = storefrontConfig?.districtCharges || {};
  const options = storefrontConfig?.shippingOptions || [];
  const mode = storefrontConfig?.shippingMode || 'auto_district';
  const defaultCharge = Number(storefrontConfig?.delivery?.charge) || 0;
  const hasRealConfig =
    !!storefrontConfig &&
    (mode === 'options'
      ? options.length > 0
      : zones.length > 0 ||
        Object.keys(districtCharges).length > 0 ||
        defaultCharge > 0);

  // District list for the lookup: the 64-district endpoint when it
  // answered, else the union of every district the config mentions.
  const districtNames: DistrictRow[] = districts.length > 0
    ? districts
    : [...new Set([
        ...zones.flatMap((z) => z.districts || []),
        ...Object.keys(districtCharges),
      ])].map((name) => ({ name }));

  const chargeFor = (district: string) =>
    resolveDeliveryCharge({
      shippingMode: mode,
      shippingOptions: options,
      district,
      shippingZones: zones,
      districtCharges,
      defaultCharge,
      // Subtotal 0 so the free-delivery threshold never zeroes the
      // displayed charge; the threshold is shown as its own banner.
      freeDeliveryMin: 0,
      subtotal: 0,
    });

  return (
    <div className="max-w-screen-xl mx-auto px-3 md:px-4 py-4 md:py-8">
      <h1 className="text-[18px] md:text-[24px] font-bold text-gray-900 mb-1">Delivery Areas</h1>
      <p className="text-[13px] text-gray-500 mb-6">We deliver across Bangladesh. Charges below are the same charges checkout applies.</p>

      {freeDeliveryMin > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <Gift size={20} className="text-green-600 shrink-0" />
          <p className="text-[13px] text-green-800 font-medium">
            Free delivery on orders over {symbol}{freeDeliveryMin.toLocaleString()}!
          </p>
        </div>
      )}

      {!hasRealConfig && legacyAreas.length === 0 ? (
        <p className="text-[13px] text-gray-500 mb-8">
          Delivery area information isn&apos;t available right now. Please check back later.
        </p>
      ) : !hasRealConfig ? (
        // Config fetch failed but a legacy CMS row exists: show it, and
        // say so — these are stored values, not the live checkout config.
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {legacyAreas.map((zone, i) => (
            <div key={i} className="bg-white rounded-[14px] border border-gray-100 p-4">
              <h3 className="text-[14px] font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <MapPin size={16} className="text-brand-blue" /> {zone.zone}
              </h3>
              <div className="flex flex-wrap gap-1 mb-3">
                {(zone.areas || []).map((area, j) => (
                  <span key={j} className="text-[11px] bg-gray-100 px-2 py-0.5 rounded-full text-gray-600">{area}</span>
                ))}
              </div>
              <div className="text-[12px] text-gray-500 space-y-1">
                <p className="flex items-center gap-1"><Truck size={12} /> {zone.charge} delivery</p>
                {zone.deliveryTime && (
                  <p className="flex items-center gap-1"><CheckCircle size={12} /> {zone.deliveryTime}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : mode === 'options' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {options.map((opt) => (
            <div key={opt.id} className="bg-white rounded-[14px] border border-gray-100 p-4">
              <h3 className="text-[14px] font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <Package size={16} className="text-brand-blue" /> {opt.name}
              </h3>
              <p className="text-[12px] text-gray-500 flex items-center gap-1">
                <Truck size={12} /> {symbol}{Number(opt.amount).toLocaleString()} delivery
              </p>
              <p className="text-[12px] text-gray-400 mt-2">
                Choose this option at checkout — the charge above is what you pay.
              </p>
            </div>
          ))}
        </div>
      ) : (
        <>
          {zones.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {zones.map((zone) => {
                const isNoDelivery = zone.type === 'no_delivery';
                const amount = zone.type === 'custom_amount' && zone.amount != null
                  ? Number(zone.amount)
                  : defaultCharge;
                return (
                  <div key={zone.id} className="bg-white rounded-[14px] border border-gray-100 p-4">
                    <h3 className="text-[14px] font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <MapPin size={16} className="text-brand-blue" /> {zone.label || 'Delivery zone'}
                    </h3>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {(zone.districts || []).map((d) => (
                        <span key={d} className="text-[11px] bg-gray-100 px-2 py-0.5 rounded-full text-gray-600">{d}</span>
                      ))}
                    </div>
                    <div className="text-[12px] text-gray-500 space-y-1">
                      <p className="flex items-center gap-1">
                        <Truck size={12} /> {isNoDelivery ? 'No delivery to these districts' : amount === 0 ? 'Free delivery' : `${symbol}${amount.toLocaleString()} delivery`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <DistrictChargeLookup
            districts={districtNames.map((d) => ({
              name: d.name,
              nameBn: d.nameBn,
              charge: chargeFor(d.name),
            }))}
            symbol={symbol}
          />
        </>
      )}
    </div>
  );
}
