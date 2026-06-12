"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getCombos } from '@/lib/api/combos';
import type { Combo } from '@/lib/types';
import { PLACEHOLDER_IMAGE, COMBO_BLUR_DATA_URL } from "@/lib/constants";
import { useCatalogImageStyle } from '@/lib/utils/image-ratio';

export default function ComboDeals() {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const aspect = useCatalogImageStyle('combo');

  useEffect(() => {
    getCombos({ isActive: true, perPage: 5 }).then(res => setCombos(res.data)).catch(() => {});
  }, []);

  if (combos.length === 0) return null;

  return (
    <section id="combo-deals" className="py-8 bg-[#fcfcfc]">
      <div className="max-w-7xl mx-auto px-4">
        <div className="bg-brand-blue/5 p-4 md:p-6 rounded-2xl border border-brand-blue/10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-blue rounded-lg flex items-center justify-center text-white">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>
                  <path d="M3 6h18"></path>
                  <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
              </div>
              <h3 className="text-[18px] md:text-[22px] font-bold text-gray-800">Exclusive Combo Deals</h3>
            </div>
            <Link href="/combos"
              className="bg-brand-blue text-white px-5 py-2 rounded-lg text-[13px] font-bold uppercase tracking-wider flex items-center gap-2 hover:bg-brand-blue/90 transition-colors">
              View All Combos
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>
              </svg>
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-5">
            {combos.map((combo, index) => {
              const savings = combo.originalPrice && combo.originalPrice > combo.price
                ? Math.round(((combo.originalPrice - combo.price) / combo.originalPrice) * 100) + '%'
                : combo.discount || '';

              const isPriority = index < 6;
              const imageSrc = imgErrors[combo.id] ? PLACEHOLDER_IMAGE : (combo.image || PLACEHOLDER_IMAGE);
              const useUnoptimized = imgErrors[combo.id] || imageSrc === PLACEHOLDER_IMAGE;

              return (
                <Link key={combo.id} href={`/combos/${combo.id}`}
                  className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm group hover:shadow-xl transition-all duration-300 flex flex-col cursor-pointer">
                  <div className={`relative ${aspect.className} p-1 bg-[#fcfcfc]`}
                    style={'style' in aspect ? aspect.style : undefined}>
                    <Image
                      src={imageSrc}
                      alt={combo.name}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 20vw"
                      priority={isPriority}
                      fetchPriority={isPriority ? "high" : "auto"}
                      loading={isPriority ? "eager" : "lazy"}
                      decoding="async"
                      placeholder={useUnoptimized ? "empty" : "blur"}
                      blurDataURL={COMBO_BLUR_DATA_URL}
                      className="object-contain transition-transform duration-500 group-hover:scale-105"
                      onError={() => setImgErrors(prev => ({ ...prev, [combo.id]: true }))}
                      unoptimized={useUnoptimized}
                    />
                    {savings && (
                      <div className="absolute top-3 left-3 bg-[#2ecc71] text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm z-10">Save {savings}</div>
                    )}
                    <div className="absolute top-3 right-3 bg-brand-blue text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm uppercase tracking-wider z-10">Combo</div>
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <h4 className="text-[14px] md:text-[15px] font-bold text-gray-800 mb-2 line-clamp-1 group-hover:text-brand-blue transition-colors">{combo.name}</h4>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-brand-blue font-black text-[15px] md:text-[16px]">৳{combo.price.toLocaleString()}</span>
                      {combo.originalPrice && <span className="text-gray-300 text-[12px] line-through font-medium">৳{combo.originalPrice.toLocaleString()}</span>}
                    </div>
                    <Link href={`/combos/${combo.id}`}
                      className="w-full bg-[#f8f9fa] text-gray-700 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-wider transition-all hover:bg-brand-blue hover:text-white border border-gray-100 block text-center">
                      View Details
                    </Link>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="flex justify-center gap-1.5 mt-8">
            <div className="w-2 h-2 rounded-full bg-brand-blue"></div>
            <div className="w-2 h-2 rounded-full bg-gray-300"></div>
          </div>
        </div>
      </div>
    </section>
  );
}
