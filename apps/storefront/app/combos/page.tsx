"use client";

import { useState, useEffect } from 'react';
import { Gift, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getCombos } from '@/lib/api/combos';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import type { Combo } from '@/lib/types';

export default function CombosPage() {
  const { config } = useStorefrontConfig();
  const router = useRouter();
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    getCombos({ isActive: true, search: searchQuery || undefined }).then(res => setCombos(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, [searchQuery]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse space-y-6 w-full max-w-4xl px-4">
          {[1,2,3].map(i => <div key={i} className="bg-gray-200 h-40 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen pb-16">
      <div className="bg-gradient-to-r from-brand-blue to-blue-700 text-white py-12 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <Gift className="w-12 h-12 mx-auto mb-4 opacity-90" />
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Combo Deals</h1>
          <p className="text-blue-100 text-lg">Save more with our exclusive bundle packages</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 -mt-8 space-y-6">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search combos..."
            className="w-full h-11 pl-10 pr-4 text-sm rounded-xl border border-gray-200 bg-white shadow-sm focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/20 transition-colors"
          />
        </div>

        {combos.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center shadow-sm">
            <Gift className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-bold text-gray-800 mb-2">No Combos Available</h3>
            <p className="text-gray-500">Check back later for new combo deals!</p>
          </div>
        ) : combos.map((combo) => {
          const savings = combo.originalPrice && combo.originalPrice > combo.price
            ? Math.round(((combo.originalPrice - combo.price) / combo.originalPrice) * 100)
            : 0;

          return (
            <div key={combo.id} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden cursor-pointer"
              onClick={() => router.push(`/combos/${combo.id}`)}>
              <div className="flex flex-col md:flex-row">
                <div className="md:w-72 h-48 md:h-auto bg-gray-100 relative overflow-hidden flex-shrink-0">
                  {combo.image ? (
                    <img src={combo.image} alt={combo.name} className="w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Gift className="w-16 h-16 text-gray-300" />
                    </div>
                  )}
                  {savings > 0 && (
                    <div className="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                      -{savings}%
                    </div>
                  )}
                </div>
                <div className="flex-1 p-6 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800 mb-2">{combo.name}</h3>
                    {combo.shortDesc && <p className="text-gray-500 text-sm mb-3">{combo.shortDesc}</p>}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {combo.items.slice(0, 4).map((item, i) => (
                        <span key={i} className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded">
                          {item.productName} x{item.quantity}
                        </span>
                      ))}
                      {combo.items.length > 4 && (
                        <span className="bg-gray-100 text-gray-500 text-xs px-2 py-1 rounded">+{combo.items.length - 4} more</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-brand-blue">{config.currency.symbol}{combo.price.toLocaleString()}</span>
                      {combo.originalPrice && combo.originalPrice > combo.price && (
                        <span className="text-gray-400 line-through text-sm">{config.currency.symbol}{combo.originalPrice.toLocaleString()}</span>
                      )}
                    </div>
                    <button className="bg-brand-blue text-white px-6 py-2 rounded-lg font-medium text-sm hover:bg-brand-blue/90 transition-colors"
                      onClick={(e) => { e.stopPropagation(); router.push(`/combos/${combo.id}`); }}>
                      View Details
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
