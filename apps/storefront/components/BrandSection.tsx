"use client";

import { useState } from 'react';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

const BRANDS = [
  { name: 'Apple', logo: PLACEHOLDER_IMAGE },
  { name: 'Samsung', logo: PLACEHOLDER_IMAGE },
  { name: 'Google', logo: PLACEHOLDER_IMAGE },
  { name: 'Sony', logo: PLACEHOLDER_IMAGE }
];

export default function BrandSection() {
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  return (
    <section className="py-8 bg-[#fcfcfc]">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-8 border-b border-gray-100 pb-2">
          <h3 className="text-[18px] font-bold text-gray-800">Our Brands</h3>
          <a href="/products" className="text-brand-blue text-[12px] font-bold uppercase tracking-wider hover:underline flex items-center gap-1">
            SEE ALL 
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"></path>
              <path d="m12 5 7 7-7 7"></path>
            </svg>
          </a>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {BRANDS.map((brand, idx) => (
            <div key={idx} className="bg-white border border-gray-100 rounded-lg p-6 flex items-center justify-center h-[100px] shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <img 
                src={imgErrors[brand.name] ? PLACEHOLDER_IMAGE : (brand.logo || PLACEHOLDER_IMAGE)} 
                alt={brand.name} 
                className="max-h-full max-w-full object-contain grayscale hover:grayscale-0 transition-all duration-300"
                onError={() => setImgErrors(prev => ({ ...prev, [brand.name]: true }))}
              />
            </div>
          ))}
        </div>

        {/* Indicators */}
        <div className="flex justify-center gap-1.5 mt-8">
           <div className="w-2.5 h-2.5 rounded-full bg-brand-blue"></div>
           <div className="w-2.5 h-2.5 rounded-full bg-gray-200"></div>
        </div>
      </div>
    </section>
  );
}
