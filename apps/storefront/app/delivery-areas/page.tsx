import type { Metadata } from "next";
import { MapPin, Truck, CheckCircle } from "lucide-react";
import { pageMetadata } from "@/lib/metadata";

const areas = [
  { zone: "Inside Dhaka", areas: ["Gulshan", "Banani", "Uttara", "Mirpur", "Mohammadpur", "Dhanmondi", "Motijheel", "Farmgate", "Bashundhara", "Baridhara"], charge: "Free", time: "24-48 hours" },
  { zone: "Outside Dhaka", areas: ["Chittagong City", "Sylhet City", "Rajshahi City", "Khulna City", "Barisal City", "Rangpur City", "Mymensingh City"], charge: "৳100-200", time: "3-5 business days" },
  { zone: "Other Districts", areas: ["All district headquarters across Bangladesh"], charge: "৳150-300", time: "5-7 business days" },
];

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("Delivery Areas", "Check if {store} delivers to your area. We deliver across Bangladesh including Dhaka, Chittagong, Sylhet, and all districts.");
}

export default function DeliveryAreasPage() {
  return (
    <div className="max-w-screen-xl mx-auto px-3 md:px-4 py-4 md:py-8">
      <h1 className="text-[18px] md:text-[24px] font-bold text-gray-900 mb-1">Delivery Areas</h1>
      <p className="text-[13px] text-gray-500 mb-6">We deliver across Bangladesh.</p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {areas.map((zone, i) => (
          <div key={i} className="bg-white rounded-[14px] border border-gray-100 p-4">
            <h3 className="text-[14px] font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <MapPin size={16} className="text-brand-blue" /> {zone.zone}
            </h3>
            <div className="flex flex-wrap gap-1 mb-3">
              {zone.areas.map((area, j) => (
                <span key={j} className="text-[11px] bg-gray-100 px-2 py-0.5 rounded-full text-gray-600">{area}</span>
              ))}
            </div>
            <div className="text-[12px] text-gray-500 space-y-1">
              <p className="flex items-center gap-1"><Truck size={12} /> {zone.charge} delivery</p>
              <p className="flex items-center gap-1"><CheckCircle size={12} /> {zone.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
