"use client";

import React, { useState } from 'react';
import { ChevronRight, ShoppingBag, Clock } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { PLACEHOLDER_IMAGE } from '@/lib/constants';
import { COMBOS } from '@/lib/combos';
import { useRouter, useParams } from 'next/navigation';

export default function ComboDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { addToCart, setIsCartOpen } = useCart();
  const [activeImg, setActiveImg] = useState('');
  const [imgErrors, setImgErrors] = useState<{ [key: string]: boolean }>({});

  const combo = COMBOS.find(c => c.id === Number(params.id));

  if (!combo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Combo not found</p>
      </div>
    );
  }

  const comboImage = activeImg || combo.image;

  const handleAddToCart = () => {
    addToCart({
      id: `combo-${combo.id}`,
      name: combo.name,
      price: combo.price,
      image: combo.image,
      category: 'combo',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    setIsCartOpen(true);
  };

  const handleImageError = (id: string) => {
    setImgErrors(prev => ({ ...prev, [id]: true }));
  };

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-4 md:py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-[12px] md:text-[13px] text-gray-400 mb-6 font-medium">
        <button onClick={() => router.push('/')} className="hover:text-brand-blue">Home</button>
        <ChevronRight size={14} />
        <span className="hover:text-brand-blue cursor-pointer">Combo Deals</span>
        <ChevronRight size={14} />
        <span className="text-gray-600">{combo.name}</span>
      </nav>

      <div className="bg-white rounded-2xl md:rounded-[32px] overflow-hidden border border-gray-100 shadow-sm p-4 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16">
          
          {/* Left: Image Section */}
          <div className="space-y-4">
            <div className="relative aspect-square md:aspect-[4/3] bg-[#fcfcfc] rounded-2xl border border-gray-50 flex items-center justify-center p-4">
              <img 
                src={imgErrors['main'] ? PLACEHOLDER_IMAGE : (comboImage || PLACEHOLDER_IMAGE)} 
                alt={combo.name} 
                className="max-w-full max-h-full object-contain" 
                onError={() => handleImageError('main')}
              />
              <div className="absolute top-4 left-4 bg-brand-blue text-white text-[10px] md:text-[12px] font-bold px-2 py-1 rounded flex items-center gap-1 uppercase">
                Combo
              </div>
              
              <button className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center text-gray-400">
                <ChevronRight size={20} className="rotate-180" />
              </button>
              <button className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center text-gray-400">
                <ChevronRight size={20} />
              </button>
            </div>
            
            {/* Thumbnails */}
            <div className="flex gap-3 overflow-x-auto pb-1">
              {[combo.image, combo.image].map((img, idx) => (
                <button 
                  key={idx}
                  onClick={() => setActiveImg(img)}
                  className={`w-16 h-16 md:w-20 md:h-20 rounded-lg border-2 flex-shrink-0 p-1 flex items-center justify-center bg-white transition-all ${comboImage === img ? 'border-brand-blue' : 'border-gray-100'}`}
                >
                  <img 
                    src={imgErrors[`thumb-${idx}`] ? PLACEHOLDER_IMAGE : (img || PLACEHOLDER_IMAGE)} 
                    alt="" 
                    className="max-w-full max-h-full object-contain" 
                    onError={() => handleImageError(`thumb-${idx}`)}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Right: Info Section */}
          <div className="flex flex-col">
            <h1 className="text-[22px] md:text-[32px] font-bold text-gray-800 mb-2">{combo.name}</h1>
            
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[20px] md:text-[28px] font-black text-brand-blue">৳{combo.price.toLocaleString()}</span>
              <span className="text-[14px] md:text-lg text-gray-400 line-through">৳{combo.originalPrice.toLocaleString()}</span>
              <span className="bg-[#e8f8f0] text-[#1caf65] text-[11px] md:text-[13px] font-bold px-2 py-0.5 rounded">
                Save {combo.discount}
              </span>
            </div>

            {/* Offer Timer Banner */}
            <div className="bg-brand-blue/5 border border-dashed border-brand-blue/10 rounded-xl p-3 md:p-4 mb-8 flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-blue/10 rounded-full flex items-center justify-center text-brand-blue">
                <Clock size={22} strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-[13px] md:text-[14px] font-bold text-gray-800">
                  Offer ends <span className="text-red-500">2 weeks from now</span>
                </p>
                <p className="text-[11px] text-gray-500">31 May 2026, 12:07 PM</p>
              </div>
            </div>

            {/* Combo Items Table */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4 border-l-4 border-brand-blue pl-3">
                <h3 className="text-[16px] md:text-[18px] font-bold text-gray-800 uppercase tracking-tight">Items in This Combo</h3>
                <span className="text-[12px] text-gray-400 font-medium font-sans">({combo.items.length} products)</span>
              </div>
              
              <div className="overflow-hidden border border-gray-100 rounded-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#f8f9fa] border-b border-gray-100">
                      <th className="px-4 py-3 text-[12px] font-bold text-gray-500 uppercase">SL</th>
                      <th className="px-4 py-3 text-[12px] font-bold text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-3 text-[12px] font-bold text-gray-500 uppercase text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {combo.items.map((item) => (
                      <tr key={item.sl} className="hover:bg-[#fcfcfc] transition-colors">
                        <td className="px-4 py-3 text-[13px] text-gray-600 font-medium">{item.sl}</td>
                        <td className="px-4 py-3 text-[13px] text-gray-800 font-bold">{item.name}</td>
                        <td className="px-4 py-3 text-[13px] text-gray-800 font-bold text-right">{item.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* CTA Button */}
            <button 
              onClick={handleAddToCart}
              className="w-full bg-brand-blue text-white h-12 md:h-14 rounded-xl flex items-center justify-center gap-3 font-bold text-[14px] md:text-[16px] uppercase tracking-wider shadow-[0_4px_16px_rgba(0,137,205,0.25)] hover:bg-brand-blue/90 transition-all active:scale-95"
            >
              <ShoppingBag size={20} strokeWidth={2.5} />
              ADD COMBO TO CART
            </button>
          </div>
        </div>

        {/* Detailed Info Section */}
        <div className="mt-12 md:mt-20 border-t border-gray-100 pt-10">
          <h3 className="text-[18px] font-bold text-gray-800 mb-6">About This Combo</h3>
          <div className="bg-[#fcfcfc] rounded-2xl p-6 md:p-8 border border-gray-50">
            <pre className="text-[14px] md:text-[15px] text-gray-600 leading-loose whitespace-pre-wrap font-sans">
              {combo.description}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
