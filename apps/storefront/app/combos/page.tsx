"use client";

import { useRouter } from "next/navigation";

const combos = [
  {
    id: 1,
    name: "iPhone + AirPods Pro Bundle",
    price: 195000,
    originalPrice: 219998,
    image: "https://placehold.co/400x300/0089CD/ffffff?text=Bundle+1",
    discount: "Save ৳24,998",
    items: ["iPhone 16 Pro Max 256GB", "AirPods Pro 3rd Gen", "Premium Case"]
  },
  {
    id: 2,
    name: "Samsung Galaxy Watch + Buds",
    price: 59999,
    originalPrice: 74998,
    image: "https://placehold.co/400x300/1428A0/ffffff?text=Bundle+2",
    discount: "Save ৳14,999",
    items: ["Galaxy Watch 7 44mm", "Galaxy Buds 3 Pro"]
  },
];

export default function CombosPage() {
  const router = useRouter();

  return (
    <div className="max-w-screen-xl mx-auto px-3 md:px-4 py-4 md:py-8">
      <h1 className="text-[18px] md:text-[24px] font-bold text-gray-900 mb-4">Combo Deals</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {combos.map((combo) => (
          <div 
            key={combo.id}
            onClick={() => router.push(`/combos/${combo.id}`)}
            className="bg-gradient-to-br from-brand-blue/5 to-brand-blue/10 rounded-[14px] border border-brand-blue/10 p-4 flex gap-4 items-center hover:shadow-lg hover:border-brand-blue/30 transition-all cursor-pointer group"
          >
            <div className="w-[120px] h-[120px] bg-white rounded-xl flex items-center justify-center p-2 flex-shrink-0">
              <img src={combo.image} alt={combo.name} className="w-full h-full object-contain" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-bold text-gray-900 mb-1">{combo.name}</h3>
              <ul className="text-[12px] text-gray-500 mb-2 space-y-0.5">
                {combo.items.map((item, i) => (
                  <li key={i} className="flex items-center gap-1"><span className="w-1 h-1 bg-brand-blue rounded-full" /> {item}</li>
                ))}
              </ul>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[20px] font-bold text-gray-900">৳{combo.price.toLocaleString()}</span>
                <span className="text-[13px] text-gray-400 line-through">৳{combo.originalPrice.toLocaleString()}</span>
              </div>
              <span className="inline-block text-[11px] text-white bg-brand-coral px-2 py-0.5 rounded-full font-bold">{combo.discount}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
