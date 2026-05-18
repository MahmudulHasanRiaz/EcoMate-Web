"use client";

import React from 'react';
import { Heart, ShoppingCart, Trash2, ArrowRight } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { PRODUCTS } from '@/lib/constants';
import type { Product } from '@/lib/types';
import { useRouter } from 'next/navigation';

export default function WishlistPage() {
  const { addToCart } = useCart();
  const router = useRouter();

  const wishlistItems = PRODUCTS.slice(0, 3);

  const handleAddToCart = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    addToCart({ ...product });
  };

  return (
    <div className="bg-[#fcfcfc] min-h-screen pb-20">
      <div className="max-w-7xl mx-auto px-4 pt-12 md:pt-20 mb-12">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2 underline decoration-brand-blue decoration-4 underline-offset-8">
              <Heart size={32} className="text-brand-blue fill-brand-blue/10" />
              <h1 className="text-3xl md:text-5xl font-black text-gray-900 tracking-tighter uppercase">My Wishlist</h1>
            </div>
            <p className="text-gray-500 font-medium text-sm md:text-base mt-6">Items you have saved for later. Prices and availability are subject to change.</p>
          </div>
          <button 
            onClick={() => router.push('/')}
            className="hidden md:flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-brand-blue transition-colors"
          >
            Back to Shopping <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4">
        {wishlistItems.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {wishlistItems.map((product) => (
              <div 
                key={product.id} 
                className="group bg-white rounded-[32px] overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-500 border border-gray-100 flex flex-col relative"
                onClick={() => router.push(`/products/${product.id}`)}
              >
                <div className="relative aspect-square overflow-hidden bg-gray-50">
                  <img 
                    src={product.image} 
                    alt={product.name} 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  {product.saveAmount && product.saveAmount > 0 && (
                    <div className="absolute top-4 left-4 bg-black text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full">
                      -{Math.round((product.saveAmount / product.originalPrice!) * 100)}%
                    </div>
                  )}
                  
                  <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <button 
                    className="absolute top-4 right-4 w-10 h-10 bg-white/90 backdrop-blur-md text-red-500 rounded-full shadow-lg flex items-center justify-center translate-x-12 group-hover:translate-x-0 transition-transform duration-500 hover:bg-red-500 hover:text-white"
                    onClick={(e) => e.stopPropagation()}
                    title="Remove from favorites"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                <div className="p-6 flex flex-col flex-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Fixed Plus Select</p>
                  <h3 className="font-bold text-gray-900 leading-tight text-lg mb-4 line-clamp-2 min-h-[3rem] group-hover:text-brand-blue transition-colors">
                    {product.name}
                  </h3>
                  
                  <div className="flex items-center gap-3 mb-6 mt-auto">
                    <span className="text-brand-blue font-black text-2xl">৳{product.price}</span>
                    {product.originalPrice && (
                      <span className="text-gray-300 text-sm line-through font-medium">৳{product.originalPrice}</span>
                    )}
                  </div>

                  <button 
                    onClick={(e) => handleAddToCart(e, product)}
                    className="w-full py-4 bg-gray-900 text-white rounded-2xl text-sm font-bold hover:bg-brand-blue transition-all flex items-center justify-center gap-3 active:scale-95 shadow-xl shadow-gray-200"
                  >
                    <ShoppingCart size={18} />
                    <span>Move to Cart</span>
                  </button>
                </div>
              </div>
            ))}

            <button 
              onClick={() => router.push('/')}
              className="group border-2 border-dashed border-gray-200 rounded-[32px] p-6 flex flex-col items-center justify-center gap-4 hover:border-brand-blue hover:bg-brand-blue/5 transition-all text-gray-300 hover:text-brand-blue"
            >
               <div className="w-16 h-16 rounded-full border-2 border-current flex items-center justify-center transition-transform group-hover:rotate-90">
                  <Trash2 size={32} className="rotate-45" />
               </div>
               <span className="font-black text-xs uppercase tracking-widest">Add more items</span>
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 p-20 text-center max-w-2xl mx-auto">
            <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-8">
               <Heart size={48} className="text-gray-200" />
            </div>
            <h3 className="text-3xl font-black text-gray-900 mb-4 tracking-tight uppercase">Your sanctuary is empty</h3>
            <p className="text-gray-500 mb-10 leading-relaxed font-medium">
              Curate your perfect tech setup. Add items you love to your wishlist to easily find them later.
            </p>
            <button 
              onClick={() => router.push('/')}
              className="bg-brand-blue hover:bg-black text-white px-12 py-4 rounded-full font-bold transition-all shadow-xl shadow-brand-blue/20 uppercase text-xs tracking-widest"
            >
              Start Curating
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
