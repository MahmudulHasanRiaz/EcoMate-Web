"use client";

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Minus, Plus, ShoppingBag, Phone, Heart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import type { Product, Variant } from "@/lib/types";
import { trackEvent } from "@/lib/tracking";
import { VariantSelector } from "./VariantSelector";
import DOMPurify from 'isomorphic-dompurify';

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-white">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
    </svg>
  );
}

function cartItemKey(productId: string, variantId?: string) {
  return variantId ? `${productId}::${variantId}` : productId;
}

export default function ProductDetailClient({ product }: { product: Product }) {
  const router = useRouter();
  const { items, addToCart, updateQuantity } = useCart();
  const { config } = useStorefrontConfig();
  const { isWishlisted, toggle } = useWishlist();
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [imgErrors, setImgErrors] = useState<{ [key: number]: boolean }>({});
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);

  const isVariable = product.type === 'variable' && (product.variants?.length ?? 0) > 0;

  const activeVariants = product.variants?.filter((v) => v.isActive && v.stock > 0) || [];

  useEffect(() => {
    if (isVariable && !selectedVariant && activeVariants.length > 0) {
      setSelectedVariant(activeVariants[0]);
    }
  }, [isVariable, selectedVariant, activeVariants]);

  useEffect(() => {
    window.scrollTo(0, 0);
    trackEvent('ViewContent', {
      content_ids: [product.id],
      value: selectedVariant?.price ?? product.price,
      currency: config.currency.code,
      content_name: product.name,
      content_type: 'product',
    });
  }, []);

  const variantLabel = selectedVariant
    ? selectedVariant.attributeValues.map((av) => av.attributeValue.value).join(' / ')
    : undefined;

  const variantAttributes = selectedVariant
    ? selectedVariant.attributeValues.map((av) => ({
        name: av.attributeValue.attribute.name,
        value: av.attributeValue.value,
      }))
    : undefined;

  const displayPrice = selectedVariant?.price ?? product.price;
  const displayOriginalPrice = product.originalPrice && product.originalPrice > displayPrice ? product.originalPrice : undefined;
  const displayImage = selectedVariant?.image || product.image;
  const displayStock = selectedVariant?.stock ?? product.stock;

  const itemGallery = isVariable
    ? [displayImage, ...(product.images?.slice(1) || [])]
    : [product.image, ...(product.images?.slice(1) || [])];

  const itemKey = cartItemKey(product.id, selectedVariant?.id);
  const cartItem = items.find((item) => {
    if (selectedVariant) return item.variantId === selectedVariant.id && item.id === product.id;
    return item.id === product.id;
  });
  const inCart = !!cartItem;
  const quantity = cartItem?.quantity || 1;

  return (
    <div className="bg-white min-h-screen pb-24">
      <div className="px-4 py-3 flex items-center gap-2 text-[14px]">
        <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-800 transition-colors">Home</button>
        <ChevronRight size={14} className="text-gray-400" />
        <span className="text-gray-800">Products</span>
      </div>

      <div className="px-4 py-4 md:py-8 max-w-screen-xl mx-auto flex flex-col md:flex-row gap-8">
        <div className="flex gap-4 md:gap-6 flex-row md:w-1/2">
          <div className="flex flex-col gap-3 w-[60px] md:w-[80px] flex-shrink-0">
            {itemGallery.map((img, i) => (
              <button key={i} onClick={() => setActiveImageIndex(i)}
                className={`w-full aspect-square border rounded-[4px] overflow-hidden flex items-center justify-center p-1 transition-colors ${activeImageIndex === i ? 'border-brand-blue' : 'border-gray-200'}`}>
                <img
                  src={imgErrors[i] ? PLACEHOLDER_IMAGE : (img || PLACEHOLDER_IMAGE)}
                  alt=""
                  className="w-full h-full object-contain"
                  onError={() => setImgErrors(prev => ({ ...prev, [i]: true }))}
                />
              </button>
            ))}
          </div>

          <div className="flex-1 border border-gray-100 rounded-[4px] relative aspect-square flex items-center justify-center p-4">
            <button className="absolute left-2 w-8 h-8 flex items-center justify-center text-blue-500 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 transition-opacity"
              onClick={() => setActiveImageIndex(prev => (prev === 0 ? itemGallery.length - 1 : prev - 1))}>
              <ChevronLeft size={24} strokeWidth={1.5} />
            </button>

            <img
              src={imgErrors[activeImageIndex] ? PLACEHOLDER_IMAGE : (itemGallery[activeImageIndex] || PLACEHOLDER_IMAGE)}
              alt={product.name}
              className="w-full h-full object-contain"
              onError={() => setImgErrors(prev => ({ ...prev, [activeImageIndex]: true }))}
            />

            <button className="absolute right-2 w-8 h-8 flex items-center justify-center text-blue-500 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 transition-opacity"
              onClick={() => setActiveImageIndex(prev => (prev === itemGallery.length - 1 ? 0 : prev + 1))}>
              <ChevronRight size={24} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="flex flex-col md:w-1/2 pt-2 md:pt-0">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[22px] md:text-[26px] text-gray-800 font-normal leading-tight mb-3">{product.name}</h1>
            <button onClick={() => toggle(product.id)}
              className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                isWishlisted(product.id)
                  ? 'bg-red-50 text-red-500'
                  : 'bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500'
              }`}>
              <Heart size={20} className={isWishlisted(product.id) ? 'fill-red-500' : ''} />
            </button>
          </div>

          <div className="flex items-center gap-3 mb-6">
            <span className="text-[20px] font-bold text-brand-blue">{config.currency.symbol}{(displayPrice ?? 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            {displayOriginalPrice && displayOriginalPrice > displayPrice && (
              <>
                <span className="text-[16px] text-gray-400 line-through">{config.currency.symbol}{(displayOriginalPrice ?? 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                <div className="bg-[#21bc5c] text-white text-[12px] px-2 py-0.5 rounded-sm font-medium tracking-wide">
                  Save {Math.round(((displayOriginalPrice - displayPrice) / displayOriginalPrice) * 100)}%
                </div>
              </>
            )}
          </div>

          {isVariable && product.variants && (
            <VariantSelector
              variants={product.variants}
              selectedVariant={selectedVariant}
              onSelect={setSelectedVariant}
            />
          )}

          <div className="flex items-center gap-6 mb-6">
            <span className="text-[16px] text-gray-800">Quantity:</span>
            <div className="flex items-center h-[38px] border border-gray-300 rounded-md overflow-hidden bg-white w-[130px]">
              <button onClick={() => inCart ? updateQuantity(itemKey, quantity - 1) : null}
                className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"><Minus size={18} /></button>
              <div className="flex-1 border-x border-gray-300 h-full flex items-center justify-center text-[16px] font-medium">{inCart ? quantity : 1}</div>
              <button onClick={() => inCart ? updateQuantity(itemKey, quantity + 1) : null}
                className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"><Plus size={18} /></button>
            </div>
          </div>

          <div className="flex gap-3 mb-4 w-full">
            <button onClick={() => { 
              if (inCart) {
                updateQuantity(itemKey, 0);
              } else {
                addToCart({
                  id: product.id,
                  name: product.name,
                  price: displayPrice,
                  originalPrice: displayOriginalPrice,
                  image: displayImage,
                  quantity: 1,
                  variantId: selectedVariant?.id,
                  variantLabel,
                  variantAttributes,
                  stock: displayStock,
                });
                trackEvent('AddToCart', {
                  content_ids: [product.id], 
                  value: displayPrice, 
                  currency: config.currency.code,
                  content_name: product.name,
                  contents: [{ id: product.id, quantity: 1, item_price: displayPrice }],
                });
              } 
            }}
              className="flex-1 h-[42px] md:h-12 rounded-[4px] bg-brand-blue hover:bg-brand-blue/90 text-white font-medium flex items-center justify-center gap-2 transition-colors text-[13px] md:text-[14px]">
              <ShoppingBag size={16} />
              {inCart ? 'REMOVE FROM CART' : 'ADD TO CART'}
            </button>
            <button onClick={() => {
              addToCart({
                id: product.id,
                name: product.name,
                price: displayPrice,
                originalPrice: displayOriginalPrice,
                image: displayImage,
                quantity: 1,
                variantId: selectedVariant?.id,
                variantLabel,
                variantAttributes,
                stock: displayStock,
              });
              router.push('/checkout');
            }}
              className="flex-1 h-[42px] md:h-12 rounded-[4px] bg-[#0c2423] hover:bg-[#071716] text-white font-medium flex items-center justify-center transition-colors uppercase text-[13px] md:text-[14px]">BUY NOW</button>
          </div>

          <div className="flex gap-3 mb-8 w-full">
            {(() => {
              const waNumber = config.order?.whatsapp || config.social.whatsapp;
              const callNumber = config.order?.callNumber || config.store.phone;
              const waHref = waNumber ? `https://wa.me/${waNumber.replace(/[^0-9]/g, '')}?text=I want to order: ${product.name}${variantLabel ? ` (${variantLabel})` : ''}` : '#';
              const callHref = callNumber ? `tel:+${callNumber.replace(/[^0-9]/g, '')}` : '#';
              return (
                <>
                  <a href={waHref}
                    target="_blank" rel="noreferrer"
                    className={`flex-1 h-[42px] md:h-12 rounded-[4px] bg-[#21bc5c] hover:bg-[#1d9e4c] text-white font-medium flex items-center justify-center gap-2 transition-colors text-[13px] md:text-[14px] ${!waNumber ? 'opacity-50 pointer-events-none' : ''}`}>
                    <WhatsAppIcon />
                    <span className="truncate">Order On WhatsApp</span>
                  </a>
                  <a href={callHref}
                    className={`flex-1 h-[42px] md:h-12 rounded-[4px] bg-[#2a3c87] hover:bg-[#212f6c] text-white font-medium flex items-center justify-center gap-2 transition-colors text-[13px] md:text-[14px] ${!callNumber ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Phone size={16} />
                    <span className="truncate">Call For Order</span>
                  </a>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {product.shortDesc && (
        <div className="px-4 max-w-screen-xl mx-auto mb-6">
          <p className="text-[14px] text-gray-600 leading-relaxed">{product.shortDesc}</p>
        </div>
      )}

      {product.description && (
        <div className="px-4 max-w-screen-xl mx-auto mb-8">
          <h3 className="text-[16px] font-semibold text-gray-800 mb-3 border-b border-gray-100 pb-2">Description</h3>
          <div className="text-[14px] text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(product.description.replace(/\\n/g, '<br>').replace(/##/g, ''), {
              ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
              ALLOWED_ATTR: ['href', 'target', 'src', 'alt', 'class', 'style', 'width', 'height'],
            })
          }} />
        </div>
      )}
    </div>
  );
}
