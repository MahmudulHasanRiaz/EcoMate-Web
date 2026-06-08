"use client";

import { useState, useEffect, useRef } from 'react';
import { ChevronRight, Minus, Plus, ShoppingBag, Phone, Heart, Truck, RefreshCw, ShieldCheck, Wallet, Copy, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import type { Product, Variant } from "@/lib/types";
import { trackEvent } from "@/lib/tracking";
import { VariantSelector } from "./VariantSelector";
import { ProductImageGallery } from "./ProductImageGallery";
import { SizeChartModal } from "./SizeChartModal";
import DOMPurify from 'isomorphic-dompurify';
import apiClient from "@/lib/api-client";
import type { SizeChartData } from "./SizeChartModal";

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

function StockBadge({ stock, manageStock }: { stock?: number; manageStock?: boolean }) {
  if (manageStock === false) {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-green-100 text-green-800">In Stock</span>;
  }
  if (stock === undefined || stock === 0) {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-red-100 text-red-800">Out of Stock</span>;
  }
  if (stock > 10) {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-green-100 text-green-800">In Stock</span>;
  }
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-orange-100 text-orange-800">Only {stock} left!</span>;
}

export default function ProductDetailClient({ product }: { product: Product }) {
  const router = useRouter();
  const { items, addToCart, updateQuantity } = useCart();
  const { config } = useStorefrontConfig();
  const { isWishlisted, toggle } = useWishlist();
  const [sizeChartOpen, setSizeChartOpen] = useState(false);
  const [sizeChartData, setSizeChartData] = useState<SizeChartData | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sizeChartLoading, setSizeChartLoading] = useState(false);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [heartPop, setHeartPop] = useState(false);
  const ctaRef = useRef<HTMLDivElement>(null);

  const isVariable = product.type === 'variable' && (product.variants?.length ?? 0) > 0;
  const activeVariants = product.variants?.filter((v) => v.isActive && v.stock > 0) || [];

  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(() => {
    if (isVariable && activeVariants.length > 0) return activeVariants[0];
    return null;
  });

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

  useEffect(() => {
    const el = ctaRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyBar(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (product.slug) {
      setSizeChartLoading(true);
      apiClient.get(`/size-charts/by-product/${product.slug}`)
        .then(res => setSizeChartData(res.data))
        .catch(err => console.warn('Size chart fetch failed:', err))
        .finally(() => setSizeChartLoading(false));
    }
  }, [product.slug]);

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

  function handleAddToCart() {
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
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1500);
    }
  }

  function handleBuyNow() {
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
  }

  function handleWishlistToggle() {
    toggle(product.id);
    setHeartPop(true);
    setTimeout(() => setHeartPop(false), 300);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleStickyAdd() {
    if (inCart && quantity > 0) {
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
    }
  }

  const [shareUrl, setShareUrl] = useState('');
  const shareText = encodeURIComponent(`Check out ${product.name}`);
  useEffect(() => { setShareUrl(encodeURIComponent(window.location.href)); }, []);

  return (
    <div className="bg-white min-h-screen pb-24 md:pb-12">
      <style>{`
        @keyframes pricePop {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
        @keyframes heartPop {
          0% { transform: scale(1); }
          50% { transform: scale(1.3); }
          100% { transform: scale(1); }
        }
      `}</style>

      <div className="px-4 py-3 flex items-center gap-2 text-[14px]">
        <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-800 transition-colors">Home</button>
        <ChevronRight size={14} className="text-gray-400" />
        {product.category ? (
          <>
            <button
              onClick={() => router.push(product.categoryId ? `/products?category=${product.categoryId}` : '/products')}
              className="text-gray-500 hover:text-gray-800 transition-colors"
            >
              {product.category}
            </button>
            <ChevronRight size={14} className="text-gray-400" />
          </>
        ) : (
          <>
            <button onClick={() => router.push('/products')} className="text-gray-500 hover:text-gray-800 transition-colors">Products</button>
            <ChevronRight size={14} className="text-gray-400" />
          </>
        )}
        <span className="text-gray-800">{product.name}</span>
      </div>

      <div className="px-4 py-4 md:py-8 max-w-screen-xl mx-auto flex flex-col md:flex-row gap-8">
        <ProductImageGallery images={itemGallery} productName={product.name} key={selectedVariant?.id || product.id} />

        <div className="flex flex-col md:w-1/2 pt-2 md:pt-0">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[22px] md:text-[26px] text-gray-800 font-normal leading-tight mb-3">{product.name}</h1>
            <button onClick={handleWishlistToggle}
              className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                isWishlisted(product.id)
                  ? 'bg-red-50 text-red-500'
                  : 'bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500'
              }`}>
              <Heart size={20} className={`${isWishlisted(product.id) ? 'fill-red-500' : ''} ${heartPop ? 'animate-[heartPop_300ms_ease]' : ''}`} />
            </button>
          </div>

          <div className="flex items-center gap-3 mb-2" key={`price-${displayPrice}-${selectedVariant?.id || ''}`}>
            <span className="text-[20px] font-bold text-brand-blue" style={{ animation: 'pricePop 300ms ease' }}>
              {config.currency.symbol}{(displayPrice ?? 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </span>
            {displayOriginalPrice && displayOriginalPrice > displayPrice && (
              <>
                <span className="text-[16px] text-gray-400 line-through">{config.currency.symbol}{(displayOriginalPrice ?? 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                <div className="bg-[#21bc5c] text-white text-[12px] px-2 py-0.5 rounded-sm font-medium tracking-wide">
                  Save {Math.round(((displayOriginalPrice - displayPrice) / displayOriginalPrice) * 100)}%
                </div>
              </>
            )}
          </div>

          <div className="mb-3">
            <StockBadge stock={displayStock} manageStock={product.manageStock} />
          </div>

          {product.sku && (
            <p className="text-[13px] text-gray-400 mb-4">Product Code: {product.sku}</p>
          )}

          {isVariable && product.variants && (
            <VariantSelector
              variants={product.variants}
              selectedVariant={selectedVariant}
              onSelect={setSelectedVariant}
            />
          )}

          {(sizeChartLoading || sizeChartData) && (
            <div className="flex items-center gap-2 mb-6">
              {sizeChartLoading && (
                <span className="text-[13px] text-gray-400 italic">Loading size chart...</span>
              )}
              {sizeChartData && (
                <button
                  onClick={() => setSizeChartOpen(true)}
                  className="text-[13px] text-brand-blue font-medium hover:underline underline-offset-2"
                >
                  Size Chart
                </button>
              )}
            </div>
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

          <div ref={ctaRef} className="flex gap-3 mb-4 w-full" data-cta-section>
            <button onClick={handleAddToCart}
              className={`flex-1 h-[42px] md:h-12 rounded-[4px] font-medium flex items-center justify-center gap-2 transition-all text-[13px] md:text-[14px] ${
                justAdded
                  ? 'bg-green-600 text-white'
                  : inCart
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-brand-blue hover:bg-brand-blue/90 text-white'
              }`}>
              {justAdded ? (
                <><Check size={16} /> ADDED</>
              ) : inCart ? (
                <><ShoppingBag size={16} /> REMOVE FROM CART</>
              ) : (
                <><ShoppingBag size={16} /> ADD TO CART</>
              )}
            </button>
            <button onClick={handleBuyNow}
              className="flex-1 h-[42px] md:h-12 rounded-[4px] bg-[#0c2423] hover:bg-[#071716] text-white font-medium flex items-center justify-center transition-colors uppercase text-[13px] md:text-[14px]">BUY NOW</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {config.delivery.freeDeliveryMin > 0 && (
              <div className="flex items-center gap-2 text-[12px] text-gray-500">
                <Truck size={16} className="text-gray-400 flex-shrink-0" />
                <span>Free Delivery</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-[12px] text-gray-500">
              <RefreshCw size={16} className="text-gray-400 flex-shrink-0" />
              <span>Easy Returns</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-gray-500">
              <ShieldCheck size={16} className="text-gray-400 flex-shrink-0" />
              <span>Secure Payment</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-gray-500">
              <Wallet size={16} className="text-gray-400 flex-shrink-0" />
              <span>COD Available</span>
            </div>
          </div>

          {(config.delivery.freeDeliveryMin > 0 || config.delivery.charge > 0) && (
            <div className="mb-6 text-[13px] text-gray-400">
              {config.delivery.freeDeliveryMin > 0 ? (
                <span>Free delivery on orders over {config.currency.symbol}{config.delivery.freeDeliveryMin.toLocaleString()}</span>
              ) : (
                config.delivery.charge > 0 && <span>Delivery fee: {config.currency.symbol}{config.delivery.charge.toLocaleString()}</span>
              )}
            </div>
          )}

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

      {product.tags && product.tags.length > 0 && (
        <div className="px-4 max-w-screen-xl mx-auto mb-6 flex flex-wrap gap-2">
          {product.tags.map((tag) => (
            <button
              key={tag}
              onClick={() => router.push(`/products?search=${encodeURIComponent(tag)}`)}
              className="inline-flex items-center px-3 py-1 bg-gray-100 hover:bg-gray-200 text-[12px] text-gray-600 rounded-full transition-colors"
            >
              {tag}
            </button>
          ))}
        </div>
      )}

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

      <div className="px-4 max-w-screen-xl mx-auto mb-8">
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-gray-500 font-medium">Share:</span>
          <button onClick={handleCopyLink}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-all">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <a href={`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`}
            target="_blank" rel="noreferrer"
            className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:text-[#1877f2] hover:border-[#1877f2] transition-all">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          </a>
          <a href={`https://wa.me/?text=${shareText}%20${shareUrl}`}
            target="_blank" rel="noreferrer"
            className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:text-[#21bc5c] hover:border-[#21bc5c] transition-all">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          </a>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 px-4 py-3 md:hidden shadow-[0_-4px_12px_rgba(0,0,0,0.08)] transition-transform duration-300 ${
        showStickyBar ? 'translate-y-0' : 'translate-y-full'
      }`}>
        <div className="flex items-center justify-between max-w-screen-xl mx-auto">
          <div>
            <span className="text-[18px] font-bold text-brand-blue">{config.currency.symbol}{(displayPrice ?? 0).toLocaleString()}</span>
            {displayOriginalPrice && <span className="text-[12px] text-gray-400 line-through ml-2">{config.currency.symbol}{(displayOriginalPrice ?? 0).toLocaleString()}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center h-[36px] border border-gray-300 rounded-md overflow-hidden">
              <button onClick={() => inCart ? updateQuantity(itemKey, quantity - 1) : null} className="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"><Minus size={16} /></button>
              <span className="w-8 text-center text-[14px] font-medium">{inCart ? quantity : 1}</span>
              <button onClick={() => inCart ? updateQuantity(itemKey, quantity + 1) : null} className="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"><Plus size={16} /></button>
            </div>
            <button onClick={handleStickyAdd} className="h-[36px] px-4 bg-brand-blue text-white text-[12px] font-medium rounded-md hover:bg-brand-blue/90 transition-colors">
              {inCart && quantity > 0 ? 'Remove' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      <SizeChartModal open={sizeChartOpen} onClose={() => setSizeChartOpen(false)} sizeChart={sizeChartData} />
    </div>
  );
}
