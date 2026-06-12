"use client";

import React, { useState, useEffect } from 'react';
import { X, ArrowRight, Gift, ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react';
import { useCart, getItemKey, VariantAttribute } from "@/context/CartContext";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import { getProducts } from "@/lib/api/products";
import { useRouter } from "next/navigation";

/**
 * Render attribute selections as "Size: M, Color: Red" for the cart drawer.
 * Prefers the rich variantAttributes array; falls back to variantLabel for
 * legacy cart items stored before this format was introduced.
 */
function formatAttributes(attrs: VariantAttribute[] | undefined, fallback?: string): string | null {
  if (attrs && attrs.length > 0) {
    return attrs.map((a) => `${a.name}: ${a.value}`).join(', ');
  }
  if (fallback && fallback.trim()) return fallback;
  return null;
}

function UpsellSection({ currencySymbol }: { currencySymbol: string }) {
  const [upsells, setUpsells] = useState<any[]>([]);
  const { addToCart } = useCart();
  const [imgErrors, setImgErrors] = useState<{ [key: string]: boolean }>({});
  const s = currencySymbol;

  useEffect(() => {
    getProducts({ isFeatured: true, perPage: 6, isActive: true })
      .then(res => setUpsells(res.data || []))
      .catch(() => {});
  }, []);

  if (upsells.length === 0) return null;

  const handleAdd = (p: any) => {
    addToCart({ id: p.id, name: p.name, price: p.price, originalPrice: p.salePrice || p.originalPrice, image: p.image, quantity: 1, slug: p.slug, category: p.category });
  };

  return (
    <div className="px-4 mt-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[16px] font-bold text-gray-800 border-b-2 border-brand-blue pb-1 inline-block">
          You May Also Like
        </h3>
      </div>
      <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide snap-x">
        {upsells.map((p: any) => (
          <div key={p.id} className="min-w-[75%] bg-white rounded-xl p-3 flex gap-3 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] border border-gray-100 snap-start">
            <div className="w-[70px] h-[70px] flex items-center justify-center bg-white flex-shrink-0">
              <img src={imgErrors[p.id] ? PLACEHOLDER_IMAGE : (p.images?.[0] || p.image)} alt={p.name}
                className="w-full h-full object-contain"
                onError={() => setImgErrors(prev => ({ ...prev, [p.id]: true }))} />
            </div>
            <div className="flex-1 flex flex-col justify-center min-w-0">
              <h4 className="text-[12px] font-medium text-gray-800 leading-snug mb-1 line-clamp-2">{p.name}</h4>
              <p className="text-[12px] text-gray-500 mb-2">{s}{p.price?.toLocaleString()}.00</p>
              <button onClick={() => handleAdd(p)}
                className="bg-[#ea7024] text-white text-[11px] px-4 py-1.5 rounded-full font-medium hover:bg-[#d66520] transition-colors w-fit">
                + Add
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CartDrawer() {
  const { items, updateQuantity, removeFromCart, cartTotal, isCartOpen, setIsCartOpen } = useCart();
  const { config } = useStorefrontConfig();
  const s = config.currency.symbol;
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
             <div className="flex items-center gap-3 p-3">
               <div className="w-11 h-11 bg-brand-blue rounded-lg flex items-center justify-center flex-shrink-0">
                  <Gift size={24} className="text-white" strokeWidth={1.5} />
               </div>
                <div className="flex-1 pr-6">
                   <p className="text-[14px] text-gray-600 leading-tight mb-1">Free delivery</p>
                   <p className="text-[14px] text-gray-800 leading-tight">
                     {config.delivery.freeDeliveryMin > 0
                       ? <>Add <span className="font-bold text-brand-blue">{s}{Math.max(0, config.delivery.freeDeliveryMin - cartTotal).toLocaleString()}</span> more to unlock!</>
                       : 'Free delivery on all orders'}
                   </p>
                </div>
                <div className="w-12 h-12 rounded-full border-2 border-gray-200 flex items-center justify-center flex-shrink-0">
                   <span className="text-[10px] font-bold text-gray-400">
                     {config.delivery.freeDeliveryMin > 0
                       ? `${Math.min(100, Math.round(cartTotal / config.delivery.freeDeliveryMin * 100))}%`
                       : 'FREE'}
                   </span>
                </div>
             </div>
              {/* Progress bar */}
              <div className="absolute bottom-0 left-0 w-full h-[4px] bg-brand-blue/10">
                <div className="h-full bg-brand-blue" style={{ width: `${Math.min(100, (cartTotal / config.delivery.freeDeliveryMin) * 100)}%` }}></div>
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
              {items.map((item) => {
                const key = getItemKey(item);
                return (
                <div key={key} className="bg-white rounded-xl p-3 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] border border-gray-100/80 relative flex gap-3">
                  <div className="w-[60px] h-[60px] md:w-[70px] md:h-[70px] bg-white rounded-lg border border-gray-100 flex items-center justify-center p-1 flex-shrink-0">
                    <img 
                      src={imgErrors[key] ? PLACEHOLDER_IMAGE : (item.image || PLACEHOLDER_IMAGE)} 
                      alt={item.name} 
                      className="w-full h-full object-contain" 
                      onError={() => handleImageError(key)}
                    />
                  </div>
                  
                   <div className="flex-1 overflow-hidden">
                      <div className="flex items-start justify-between gap-2 pr-6">
                        <div className="min-w-0">
                          <h4 className="text-[14px] font-medium text-gray-800 leading-tight break-words">
                            {item.name}
                          </h4>
                          {(() => {
                            const attrText = formatAttributes(item.variantAttributes, item.variantLabel);
                            if (attrText) {
                              return (
                                <span className="block text-[11px] text-gray-500 font-normal mt-0.5">
                                  {attrText}
                                </span>
                              );
                            }
                            if (item.variantId) {
                              return (
                                <span className="block text-[11px] text-gray-400 font-normal mt-0.5">
                                  Variant selected
                                </span>
                              );
                            }
                            return null;
                          })()}
                          {item.isCombo && item.comboItems && (
                            <div className="space-y-0.5 mt-1">
                              {item.comboItems.map((sub: any, idx: number) => {
                                const selAttrs = item.comboSelectionAttributes?.[sub.productId];
                                const selLabel = item.comboSelectionLabels?.[sub.productId];
                                const subAttrText = formatAttributes(selAttrs, selLabel);
                                return (
                                  <div key={idx} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
                                    <span className="text-gray-600">{sub.productName}</span>
                                    <span className="text-gray-400">&times;{sub.quantity}</span>
                                    {subAttrText && <span className="text-brand-blue">({subAttrText})</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                     
                     <div className="flex items-center gap-2 mt-2">
                      <div className="flex items-center h-7 rounded-sm border border-gray-200 bg-white">
                        <button 
                          onClick={() => updateQuantity(key, item.quantity - 1)}
                          className="w-7 h-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors text-lg"
                        >
                          -
                        </button>
                        <div className="w-6 text-center text-[13px] font-medium text-gray-900 border-x border-gray-200 h-full flex items-center justify-center">
                          {item.quantity}
                        </div>
                        <button 
                          onClick={() => updateQuantity(key, item.quantity + 1)}
                          className="w-7 h-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors text-lg"
                        >
                          +
                        </button>
                      </div>
                      
                      <div className="font-sans text-[13px] text-gray-800 whitespace-nowrap hidden sm:block">
                        &times; {s}{item.price.toLocaleString()}.00 
                      </div>
                      <div className="font-sans text-[13px] font-medium text-gray-900 whitespace-nowrap">
                        = {s}{(item.price * item.quantity).toLocaleString()}.00
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => removeFromCart(key)}
                    className="absolute top-2.5 right-2.5 text-gray-500 hover:text-gray-800 transition-colors p-1"
                  >
                    <X size={18} strokeWidth={1.5} />
                  </button>
                </div>
                );
              })}
            </div>
          )}

          {/* You May Also Like (from footer upsells) */}
          {items.length > 0 && <UpsellSection currencySymbol={s} />}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-4 bg-[#f8f9fa] border-t border-gray-100">
            <div className="flex justify-between items-center mb-4 px-1">
              <span className="text-[16px] text-gray-800 font-medium tracking-wide">Total:</span>
              <span className="text-[18px] font-medium text-gray-900 tracking-wide">{s}{cartTotal.toLocaleString()}.00</span>
            </div>
            
            <button 
              onClick={() => {
                setIsCartOpen(false);
                router.push('/checkout');
              }}
              className="w-full h-12 bg-brand-blue hover:bg-brand-blue/90 text-white font-medium text-[15px] rounded-[6px] flex items-center justify-center tracking-wide uppercase animate-[bump_2s_ease-in-out_infinite]"
            >
              Checkout
            </button>
          </div>
        )}
      </div>
    </>
  );
}
