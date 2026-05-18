"use client";

import React, { useState } from 'react';
import { X, ArrowRight, Gift, ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react';
import { useCart } from "@/context/CartContext";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import { useRouter } from "next/navigation";

export default function CartDrawer() {
  const { items, updateQuantity, removeFromCart, cartTotal, isCartOpen, setIsCartOpen } = useCart();
  const router = useRouter();
  const [imgErrors, setImgErrors] = useState<{ [key: string]: boolean }>({});

  const handleImageError = (id: string) => {
    setImgErrors(prev => ({ ...prev, [id]: true }));
  };

  if (!isCartOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-[60] backdrop-blur-sm transition-opacity"
        onClick={() => setIsCartOpen(false)}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full sm:w-[400px] bg-[#fcfcfc] z-[70] shadow-2xl flex flex-col transform transition-transform duration-300">
        
        {/* Header */}
        <div className="px-4 flex items-center justify-between h-14 border-b border-gray-100 bg-white shadow-sm">
          <h2 className="text-[15px] font-semibold text-gray-800 tracking-wide">
            SHOPPING CART
          </h2>
          <button 
            onClick={() => setIsCartOpen(false)}
            className="flex items-center gap-1.5 text-[15px] text-gray-700 hover:text-gray-900 transition-colors"
          >
            Close <ArrowRight size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-24 bg-[#fafafa]">
          {/* Promo Banner */}
            <div className="m-4 mb-6 rounded-[12px] border border-brand-blue/10 bg-brand-blue/5 relative overflow-hidden shadow-sm">
             <button className="absolute top-2 right-2 text-gray-400 p-1 hover:text-gray-600 transition-colors">
               <X size={16} strokeWidth={2} />
             </button>
             <div className="flex items-center gap-3 p-3">
               <div className="w-11 h-11 bg-brand-blue rounded-lg flex items-center justify-center flex-shrink-0">
                  <Gift size={24} className="text-white" strokeWidth={1.5} />
               </div>
               <div className="flex-1 pr-6">
                  <p className="text-[14px] text-gray-600 leading-tight mb-1">Get special coupon</p>
                  <p className="text-[14px] text-gray-800 leading-tight">
                    Add <span className="font-bold text-brand-blue">৳3,450</span> more to unlock!
                  </p>
               </div>
             </div>
             {/* Progress bar */}
             <div className="absolute bottom-0 left-0 w-full h-[4px] bg-brand-blue/10">
               <div className="h-full bg-brand-blue w-[25%]"></div>
             </div>
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-24 h-24 bg-brand-blue/10 rounded-full flex items-center justify-center text-brand-blue">
                <ShoppingBag size={48} className="stroke-[1.5]" />
              </div>
              <div>
                <p className="text-gray-900 font-bold text-lg mb-1">Your cart is empty</p>
                <p className="text-gray-500 text-sm">Looks like you haven&apos;t added anything yet.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 px-4 z-10 mb-8">
              {items.map((item) => (
                <div key={item.id} className="bg-white rounded-xl p-3 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] border border-gray-100/80 relative flex gap-3">
                  <div className="w-[60px] h-[60px] md:w-[70px] md:h-[70px] bg-white rounded-lg border border-gray-100 flex items-center justify-center p-1 flex-shrink-0">
                    <img 
                      src={imgErrors[item.id] ? PLACEHOLDER_IMAGE : (item.image || PLACEHOLDER_IMAGE)} 
                      alt={item.name} 
                      className="w-full h-full object-contain" 
                      onError={() => handleImageError(item.id)}
                    />
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-center">
                    <div className="flex items-start justify-between gap-2 pr-6">
                       <h4 className="text-[14px] font-medium text-gray-800 line-clamp-1 leading-tight mb-2">
                         {item.name}
                       </h4>
                    </div>
                    
                    <div className="flex items-center gap-2 mt-auto">
                      <div className="flex items-center h-7 rounded-sm border border-gray-200 bg-white">
                        <button 
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-7 h-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors text-lg"
                        >
                          -
                        </button>
                        <div className="w-6 text-center text-[13px] font-medium text-gray-900 border-x border-gray-200 h-full flex items-center justify-center">
                          {item.quantity}
                        </div>
                        <button 
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-7 h-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors text-lg"
                        >
                          +
                        </button>
                      </div>
                      
                      <div className="font-sans text-[13px] text-gray-800 whitespace-nowrap hidden sm:block">
                        &times; ৳{item.price.toLocaleString()}.00 
                      </div>
                      <div className="font-sans text-[13px] font-medium text-gray-900 whitespace-nowrap">
                        = ৳{(item.price * item.quantity).toLocaleString()}.00
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => removeFromCart(item.id)}
                    className="absolute top-2.5 right-2.5 text-gray-500 hover:text-gray-800 transition-colors p-1"
                  >
                    <X size={18} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* You May Also Like (Mock) */}
          {items.length > 0 && (
            <div className="px-4 mt-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[16px] font-bold text-gray-800 border-b-2 border-brand-blue pb-1 inline-block">
                  You May Also Like
                </h3>
                <div className="flex gap-2">
                  <button className="w-7 h-7 rounded-full bg-brand-blue text-white flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">
                    <ChevronLeft size={16} />
                  </button>
                  <button className="w-7 h-7 rounded-full bg-brand-blue text-white flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide snap-x">
                {/* Dummy Item 1 to show cut-off */}
                <div className="min-w-[85%] bg-white rounded-xl p-3 flex gap-3 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] border border-gray-100 snap-start">
                  <div className="w-[80px] h-[80px] flex items-center justify-center bg-white flex-shrink-0">
                    <img 
                      src={imgErrors['mock-1'] ? PLACEHOLDER_IMAGE : "https://admin.ghorerbazar.com/public/uploads/all/q33Q5xQzOrp5zR1Gg8f1N8K1L5i23G4KxRQbTGLy.jpg"} 
                      alt="Natural Honeycomb" 
                      className="w-[80%] h-[80%] object-contain"
                      onError={() => handleImageError('mock-1')}
                    />
                  </div>
                  <div className="flex-1 flex flex-col justify-center">
                     <h4 className="text-[13px] font-medium text-gray-800 leading-snug mb-1 line-clamp-2">Natural Honeycomb-2000gm (Briefcase)</h4>
                     <p className="text-[13px] text-gray-500 mb-2">৳5,000.00</p>
                     <div>
                        <button className="bg-[#ea7024] text-white text-[12px] px-4 py-1 rounded-full font-medium hover:bg-[#d66520] transition-colors">
                          + Add
                        </button>
                     </div>
                  </div>
                </div>
                {/* Dummy Item 2 */}
                <div className="min-w-[85%] bg-white rounded-xl p-3 flex gap-3 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] border border-gray-100 snap-start">
                  <div className="w-[80px] h-[80px] flex items-center justify-center bg-white flex-shrink-0">
                     <div className="text-[10px] text-gray-400">100gm</div>
                  </div>
                  <div className="flex-1 flex flex-col justify-center">
                     <h4 className="text-[13px] font-medium text-gray-800 leading-snug mb-1 line-clamp-2">Another Product</h4>
                     <p className="text-[13px] text-gray-500 mb-2">৳1,200.00</p>
                     <div>
                        <button className="bg-[#ea7024] text-white text-[12px] px-4 py-1 rounded-full font-medium hover:bg-[#d66520] transition-colors">
                          + Add
                        </button>
                     </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-4 bg-[#f8f9fa] border-t border-gray-100">
            <div className="flex justify-between items-center mb-4 px-1">
              <span className="text-[16px] text-gray-800 font-medium tracking-wide">Total:</span>
              <span className="text-[18px] font-medium text-gray-900 tracking-wide">৳{cartTotal.toLocaleString()}.00</span>
            </div>
            
            <button 
              onClick={() => {
                setIsCartOpen(false);
                router.push('/checkout');
              }}
              className="w-full h-12 bg-brand-blue hover:bg-brand-blue/90 text-white font-medium text-[15px] rounded-[6px] flex items-center justify-center transition-colors tracking-wide uppercase"
            >
              Checkout
            </button>
          </div>
        )}
      </div>
    </>
  );
}
