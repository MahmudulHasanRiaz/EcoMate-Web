import { MapPin, Truck, CheckCircle, Gift } from "lucide-react";

interface DeliveryAreaZone {
  zone?: string;
  charge?: string;
  deliveryTime?: string;
  areas?: string[];
}

export default function DeliveryAreasTemplate({ config }: { config: Record<string, any> }) {
  const areas: DeliveryAreaZone[] = Array.isArray(config.areas) ? config.areas : [];
  const freeDeliveryMin = Number(config.freeDeliveryMin) || 0;

  return (
    <div className="max-w-screen-xl mx-auto px-3 md:px-4 py-4 md:py-8">
      <h1 className="text-[18px] md:text-[24px] font-bold text-gray-900 mb-1">Delivery Areas</h1>
      <p className="text-[13px] text-gray-500 mb-6">We deliver across Bangladesh.</p>

      {freeDeliveryMin > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <Gift size={20} className="text-green-600 shrink-0" />
          <p className="text-[13px] text-green-800 font-medium">
            Free delivery on orders over ৳{freeDeliveryMin.toLocaleString()}!
          </p>
        </div>
      )}

      {areas.length === 0 ? (
        <p className="text-[13px] text-gray-500 mb-8">
          Delivery area information isn&apos;t available right now. Please check back later.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {areas.map((zone, i) => (
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
                <p className="flex items-center gap-1"><CheckCircle size={12} /> {zone.deliveryTime}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
