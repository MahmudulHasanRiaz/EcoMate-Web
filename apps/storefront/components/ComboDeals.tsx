"use client";

import React from 'react';
import { COMBOS } from '@/lib/combos';
import { PLACEHOLDER_IMAGE } from '@/lib/constants';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';

export default function ComboDeals() {
  const router = useRouter();
  const [imgErrors, setImgErrors] = React.useState<{ [key: number]: boolean }>({});

  const handleImageError = (id: number) => {
    setImgErrors(prev => ({ ...prev, [id]: true }));
  };

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
            <button 
              onClick={() => router.push('/combos')}
              className="bg-brand-blue text-white px-5 py-2 rounded-lg text-[13px] font-bold uppercase tracking-wider flex items-center gap-2 hover:bg-brand-blue/90 transition-colors"
            >
              View All Combos
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-5">
            {COMBOS.map((combo) => (
              <motion.div 
                key={combo.id} 
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm group hover:shadow-xl transition-all duration-300 flex flex-col cursor-pointer"
                onClick={() => router.push(`/combos/${combo.id}`)}
              >
                <div className="relative aspect-square p-1 bg-[#fcfcfc]">
                  <motion.img 
                    whileHover={{ scale: 1.05 }}
                    src={imgErrors[combo.id] ? PLACEHOLDER_IMAGE : (combo.image || PLACEHOLDER_IMAGE)} 
                    alt={combo.name} 
                    className="w-full h-full object-contain" 
                    onError={() => handleImageError(combo.id)}
                  />
                  <div className="absolute top-3 left-3 bg-[#2ecc71] text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">
                    Save {combo.discount}
                  </div>
                  <div className="absolute top-3 right-3 bg-brand-blue text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm uppercase tracking-wider">
                    Combo
                  </div>
                </div>
                <div className="p-4 flex flex-col flex-1">
                  <h4 className="text-[14px] md:text-[15px] font-bold text-gray-800 mb-2 line-clamp-1 group-hover:text-brand-blue transition-colors">{combo.name}</h4>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-brand-blue font-black text-[15px] md:text-[16px]">৳{combo.price.toLocaleString()}</span>
                    <span className="text-gray-300 text-[12px] line-through font-medium">৳{combo.originalPrice.toLocaleString()}</span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); router.push(`/combos/${combo.id}`); }}
                    className="w-full bg-[#f8f9fa] text-gray-700 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-wider transition-all hover:bg-brand-blue hover:text-white border border-gray-100"
                  >
                    View Details
                  </button>
                </div>
              </motion.div>
            ))}
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
