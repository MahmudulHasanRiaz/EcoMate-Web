"use client";

import React, { useState } from 'react';
import { MapPin, Phone, Clock, Navigation } from 'lucide-react';

const PLACEHOLDER_IMAGE = "https://placehold.co/600x600/f8f9fa/a0aec0?text=No+Image";

export default function StoresPage() {
  const [imgErrors, setImgErrors] = useState<{ [key: string]: boolean }>({});

  return (
    <div className="bg-[#fcfcfc] min-h-screen">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 pt-16 md:pt-24 pb-12">
        <h1 className="text-5xl md:text-8xl font-black text-gray-900 tracking-tighter uppercase leading-[0.8] mb-8">
          FIND OUR <br /><span className="text-brand-blue">STORES.</span>
        </h1>
        <div className="flex flex-col md:flex-row md:items-center gap-6 justify-between border-t border-gray-200 pt-10">
           <p className="text-gray-500 max-w-md text-sm md:text-base leading-relaxed">
             Experience the innovation of Fixed Plus in person. Visit our physical store to explore our signature products.
           </p>
           <a 
             href="https://maps.app.goo.gl/mT4GwfLr9AE6SFqS8" 
             target="_blank" 
             rel="noopener noreferrer"
             className="flex items-center gap-2 bg-brand-blue text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-brand-blue/20 hover:scale-105 transition-transform whitespace-nowrap"
           >
             <MapPin size={18} />
             View Location
           </a>
        </div>
      </div>

      {/* Stores Grid */}
      <div className="max-w-7xl mx-auto px-4 py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {/* Main Store */}
          <div className="group bg-white rounded-[40px] overflow-hidden border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-500">
               <div className="relative aspect-[4/3] overflow-hidden">
                  <img 
                    src={imgErrors['store-1'] ? PLACEHOLDER_IMAGE : "https://images.unsplash.com/photo-1534723452862-4c874018d66d?auto=format&fit=crop&q=80&w=1200"} 
                    alt="Fixed Plus Warehouse" 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    onError={() => setImgErrors(prev => ({ ...prev, 'store-1': true }))}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <a 
                    href="https://maps.app.goo.gl/mT4GwfLr9AE6SFqS8" 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute bottom-6 right-6 w-12 h-12 bg-white rounded-full flex items-center justify-center text-brand-blue shadow-xl translate-y-12 group-hover:translate-y-0 transition-transform"
                  >
                     <Navigation size={20} fill="currentColor" />
                  </a>
               </div>
               <div className="p-8">
                  <h3 className="text-2xl font-bold text-gray-900 mb-6 font-mono tracking-tighter">FIXED PLUS FLAGSHIP STORE</h3>
                  <div className="space-y-4">
                     <StoreDetail icon={<MapPin size={16} />} text="Shop 63-64, Block D, Level 6, Bashundhara City Shopping Mall, Dhaka" />
                     <StoreDetail icon={<Phone size={16} />} text="+880 1700-000000" />
                     <StoreDetail icon={<Clock size={16} />} text="10:00 AM - 8:00 PM (Closed on Tuesday)" />
                  </div>
                  <div className="mt-8 pt-8 border-t border-gray-50">
                     <a 
                       href="https://maps.app.goo.gl/mT4GwfLr9AE6SFqS8" 
                       target="_blank"
                       rel="noopener noreferrer"
                       className="w-full text-xs font-black uppercase tracking-widest text-brand-blue hover:tracking-[0.2em] transition-all text-left block"
                     >
                        Open In Google Maps —
                     </a>
                  </div>
               </div>
           </div>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StoreDetail({ icon, text }: { icon: any, text: string }) {
  return (
    <div className="flex gap-4 items-start text-gray-500">
       <div className="mt-1 text-brand-blue">{icon}</div>
       <span className="text-[14px] leading-relaxed font-medium">{text}</span>
    </div>
  );
}
