"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

interface Brand {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
}

export default function BrandSection() {
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_API_URL + '/brands?activeOnly=true')
      .then(res => res.json())
      .then(data => {
        setBrands(Array.isArray(data) ? data : data?.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch brands", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <section className="py-8 bg-[#fcfcfc]">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between mb-8 border-b border-gray-100 pb-2">
            <h3 className="text-[18px] font-bold text-gray-800">Our Brands</h3>
          </div>
          <div className="flex justify-center py-8">
            <div className="animate-pulse flex space-x-4">
              <div className="rounded bg-slate-200 h-24 w-32"></div>
              <div className="rounded bg-slate-200 h-24 w-32"></div>
              <div className="rounded bg-slate-200 h-24 w-32"></div>
              <div className="rounded bg-slate-200 h-24 w-32"></div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (brands.length === 0) return null;

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
          {brands.map((brand) => {
            const logoUrl = brand.logo ? (brand.logo.startsWith('http') ? brand.logo : `${process.env.NEXT_PUBLIC_MEDIA_URL}/${brand.logo}`) : PLACEHOLDER_IMAGE;
            return (
              <div key={brand.id} className="bg-white border border-gray-100 rounded-lg p-6 flex items-center justify-center h-[100px] shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <Image 
                  src={imgErrors[brand.name] ? PLACEHOLDER_IMAGE : logoUrl} 
                  alt={brand.name} 
                  width={120} height={60}
                  className="max-h-full max-w-full object-contain grayscale hover:grayscale-0 transition-all duration-300"
                  onError={() => setImgErrors(prev => ({ ...prev, [brand.name]: true }))}
                />
              </div>
            )
          })}
        </div>

        {/* Indicators */}
        {brands.length > 4 && (
          <div className="flex justify-center gap-1.5 mt-8">
             <div className="w-2.5 h-2.5 rounded-full bg-brand-blue"></div>
             <div className="w-2.5 h-2.5 rounded-full bg-gray-200"></div>
          </div>
        )}
      </div>
    </section>
  );
}
