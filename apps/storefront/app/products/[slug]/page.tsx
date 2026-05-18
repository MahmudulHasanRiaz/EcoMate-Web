"use client";

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Minus, Plus, ShoppingBag, Phone } from 'lucide-react';
import { PLACEHOLDER_IMAGE } from '@/lib/constants';
import { PRODUCTS } from '@/lib/constants';
import { useCart } from '@/context/CartContext';
import { useRouter, useParams } from 'next/navigation';

export default function ProductPage() {
  const params = useParams();
  const router = useRouter();
  const { items, addToCart, updateQuantity } = useCart();
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [imgErrors, setImgErrors] = useState<{ [key: number]: boolean }>({});

  const product = PRODUCTS.find(p => p.id === params.slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Product not found</p>
      </div>
    );
  }

  const itemGallery = [product.image, product.image];

  const handleImageError = (index: number) => {
    setImgErrors(prev => ({ ...prev, [index]: true }));
  };

  const cartItem = items.find((item) => item.id === product.id);
  const inCart = !!cartItem;
  const quantity = cartItem?.quantity || 1;

  return (
    <div className="bg-white min-h-screen pb-24">
      {/* Breadcrumb */}
      <div className="px-4 py-3 flex items-center gap-2 text-[14px]">
        <button 
          onClick={() => router.push('/')}
          className="text-gray-500 hover:text-gray-800 transition-colors"
        >
          Home
        </button>
        <ChevronRight size={14} className="text-gray-400" />
        <span className="text-gray-800">Products</span>
      </div>

      <div className="px-4 py-4 md:py-8 max-w-screen-xl mx-auto flex flex-col md:flex-row gap-8">
        
        {/* Images Section */}
        <div className="flex gap-4 md:gap-6 flex-row md:w-1/2">
          {/* Thumbnails */}
          <div className="flex flex-col gap-3 w-[60px] md:w-[80px] flex-shrink-0">
            {itemGallery.map((img, i) => (
              <button 
                key={i}
                onClick={() => setActiveImageIndex(i)}
                className={`w-full aspect-square border rounded-[4px] overflow-hidden flex items-center justify-center p-1 transition-colors ${activeImageIndex === i ? 'border-brand-blue' : 'border-gray-200'}`}
              >
                <img 
                  src={imgErrors[i] ? PLACEHOLDER_IMAGE : (img || PLACEHOLDER_IMAGE)} 
                  alt="" 
                  className="w-full h-full object-contain"
                  onError={() => handleImageError(i)}
                />
              </button>
            ))}
          </div>

          {/* Main Image */}
          <div className="flex-1 border border-gray-100 rounded-[4px] relative aspect-square flex items-center justify-center p-4">
            <button 
              className="absolute left-2 w-8 h-8 flex items-center justify-center text-blue-500 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 transition-opacity"
              onClick={() => setActiveImageIndex(prev => (prev === 0 ? itemGallery.length - 1 : prev - 1))}
            >
              <ChevronLeft size={24} strokeWidth={1.5} />
            </button>
            
            <img 
              src={imgErrors[activeImageIndex] ? PLACEHOLDER_IMAGE : (itemGallery[activeImageIndex] || PLACEHOLDER_IMAGE)} 
              alt={product.name} 
              className="w-full h-full object-contain" 
              onError={() => handleImageError(activeImageIndex)}
            />

            <button 
              className="absolute right-2 w-8 h-8 flex items-center justify-center text-blue-500 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 transition-opacity"
              onClick={() => setActiveImageIndex(prev => (prev === itemGallery.length - 1 ? 0 : prev + 1))}
            >
              <ChevronRight size={24} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Details Section */}
        <div className="flex flex-col md:w-1/2 pt-2 md:pt-0">
          <h1 className="text-[22px] md:text-[26px] text-gray-800 font-normal leading-tight mb-3">
            {product.name}
          </h1>

          <div className="flex items-center gap-3 mb-6">
            <span className="text-[20px] font-bold text-brand-blue">
              ৳{(product.price).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </span>
            {product.originalPrice && (
              <>
                <span className="text-[16px] text-gray-400 line-through">
                  ৳{(product.originalPrice).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </span>
                <div className="bg-[#21bc5c] text-white text-[12px] px-2 py-0.5 rounded-sm font-medium tracking-wide">
                  Save {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}%
                </div>
              </>
            )}
          </div>

          {/* Quantity Selector */}
          <div className="flex items-center gap-6 mb-6">
            <span className="text-[16px] text-gray-800">Quantity:</span>
            <div className="flex items-center h-[38px] border border-gray-300 rounded-md overflow-hidden bg-white w-[130px]">
              <button 
                onClick={() => inCart ? updateQuantity(product.id, quantity - 1) : null}
                className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"
              >
                <Minus size={18} />
              </button>
              <div className="flex-1 border-x border-gray-300 h-full flex items-center justify-center text-[16px] font-medium">
                {inCart ? quantity : 1}
              </div>
              <button 
                onClick={() => inCart ? updateQuantity(product.id, quantity + 1) : null}
                className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          {/* Primary Actions */}
          <div className="flex gap-3 mb-4 w-full">
            <button 
              onClick={() => {
                if (inCart) {
                  updateQuantity(product.id, 0);
                } else {
                  addToCart(product);
                }
              }}
              className="flex-1 h-[42px] md:h-12 rounded-[4px] bg-brand-blue hover:bg-brand-blue/90 text-white font-medium flex items-center justify-center gap-2 transition-colors text-[13px] md:text-[14px]"
            >
              <ShoppingBag size={16} />
              {inCart ? 'REMOVE FROM CART' : 'ADD TO CART'}
            </button>
            <button 
              className="flex-1 h-[42px] md:h-12 rounded-[4px] bg-[#0c2423] hover:bg-[#071716] text-white font-medium flex items-center justify-center transition-colors uppercase text-[13px] md:text-[14px]"
            >
              BUY NOW
            </button>
          </div>

          {/* Secondary Actions */}
          <div className="flex gap-3 mb-8 w-full">
            <button className="flex-1 h-[42px] md:h-12 rounded-[4px] bg-[#21bc5c] hover:bg-[#1d9e4c] text-white font-medium flex items-center justify-center gap-2 transition-colors text-[13px] md:text-[14px]">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
              </svg>
              <span className="truncate">Order On WhatsApp</span>
            </button>
            <button className="flex-1 h-[42px] md:h-12 rounded-[4px] bg-[#2a3c87] hover:bg-[#212f6c] text-white font-medium flex items-center justify-center gap-2 transition-colors text-[13px] md:text-[14px]">
              <Phone size={16} />
              <span className="truncate">Call For Order</span>
            </button>
          </div>

          {/* Brand Info */}
          <div className="inline-flex items-center gap-3 border border-gray-200 px-4 py-2 rounded-[4px] self-start min-w-[200px]">
            <span className="text-[14px] text-gray-700">Brand:</span>
            <div className="flex flex-col items-center leading-none">
              <div className="font-bold text-[22px] text-black tracking-tighter flex items-center">
                <span className="mr-[1px] font-black">SH</span>
                <span className="text-brand-blue mr-[1px] flex items-center justify-center relative">
                   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mb-0.5">
                     <circle cx="12" cy="12" r="10" />
                     <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" />
                   </svg>
                </span>
                <span className="font-black">STI</span>
              </div>
              <span className="text-[8px] font-bold tracking-[0.2em] -mt-1 ml-4 uppercase">Food</span>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
