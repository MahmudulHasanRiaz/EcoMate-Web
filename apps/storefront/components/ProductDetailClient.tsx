"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronRight, Minus, Plus, ShoppingBag, Phone, Heart, Copy, Check, Star, Truck, RefreshCw, ShieldCheck, Wallet, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import type { Product, Variant, Review } from "@/lib/types";
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

function StockBadge({ stock }: { stock?: number }) {
  if (stock === undefined) return null;
  if (stock === 0) {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-red-100 text-red-800">Out of Stock</span>;
  }
  if (stock > 10) {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-green-100 text-green-800">In Stock</span>;
  }
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-orange-100 text-orange-800">Only {stock} left!</span>;
}

function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          className={star <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}
        />
      ))}
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function sanitizeHTML(html: string): string {
  return DOMPurify.sanitize(html.replace(/\\n/g, '<br>').replace(/##/g, ''), {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'target', 'src', 'alt', 'class', 'style', 'width', 'height'],
  });
}

function ReviewForm({ productId, onSubmitted }: { productId: string; onSubmitted: () => void }) {
  const [name, setName] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  if (submitted) {
    return (
      <div className="text-center py-6 px-4 bg-green-50 rounded-lg">
        <Check size={28} className="mx-auto text-green-600 mb-2" />
        <p className="text-[14px] font-semibold text-green-800 mb-1">Thank you for your review!</p>
        <p className="text-[13px] text-green-600">It will be visible once approved by the admin.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter your name'); return; }
    if (rating < 1) { setError('Please select a rating'); return; }
    setError('');
    setSubmitting(true);
    try {
      await apiClient.post('/reviews', {
        productId,
        customerName: name.trim(),
        rating,
        text: text.trim() || undefined,
      });
      setSubmitted(true);
      setTimeout(onSubmitted, 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="text-[13px] text-red-500 bg-red-50 rounded-lg px-4 py-2">{error}</p>
      )}
      <div>
        <p className="text-[13px] text-gray-500 mb-2">Your Rating</p>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map(s => (
            <button key={s} type="button"
              onClick={() => setRating(s)}
              onMouseEnter={() => setHoverRating(s)}
              onMouseLeave={() => setHoverRating(0)}
              className="p-0.5 transition-transform hover:scale-110"
            >
              <Star
                size={22}
                className={s <= (hoverRating || rating) ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}
                strokeWidth={1.5}
              />
            </button>
          ))}
        </div>
      </div>
      <div>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your Name"
          className="w-full h-[42px] px-4 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
        />
      </div>
      <div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Write your review (optional)"
          rows={3}
          className="w-full px-4 py-3 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue resize-none"
        />
      </div>
      <button type="submit" disabled={submitting}
        className="w-full h-[42px] rounded-lg bg-brand-blue text-white text-[14px] font-semibold flex items-center justify-center gap-2 transition-all hover:bg-brand-blue-dark disabled:opacity-50"
      >
        {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
        Submit Review
      </button>
    </form>
  );
}

function ReviewsSection({ reviews, productId }: { reviews?: Review[]; productId: string }) {
  const [showForm, setShowForm] = useState(false);

  const hasReviews = reviews && reviews.length > 0;
  const avgRating = hasReviews ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
  const totalReviews = hasReviews ? reviews.length : 0;

  return (
    <div className="border-t border-gray-100 pt-8 mt-8">
      <h3 className="text-[16px] font-semibold text-gray-800 mb-4">Reviews</h3>

      {hasReviews ? (
        <>
          <div className="flex items-center gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="text-center">
              <span className="text-[36px] font-bold text-gray-800 leading-none">{avgRating.toFixed(1)}</span>
              <div className="mt-1">
                <StarRating rating={avgRating} size={18} />
              </div>
              <span className="text-[12px] text-gray-400 mt-1 block">{totalReviews} Reviews</span>
            </div>
          </div>
          <div className="space-y-4 mb-6">
            {reviews.map((review) => (
              <div key={review.id} className="border-b border-gray-50 pb-4 last:border-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[14px] font-medium text-gray-800">{review.customerName}</span>
                  <span className="text-[11px] text-gray-400">{formatDate(review.createdAt)}</span>
                </div>
                <StarRating rating={review.rating} size={14} />
                {review.text && <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">{review.text}</p>}
              </div>
            ))}
          </div>
          {!showForm && (
            <button onClick={() => setShowForm(true)}
              className="w-full h-[42px] rounded-lg border-2 border-brand-blue text-brand-blue text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-brand-blue/5 transition-colors"
            >
              Write a Review
            </button>
          )}
        </>
      ) : (
        <div className="text-center py-10 px-4 bg-gray-50 rounded-lg mb-4">
          <Star size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-[14px] text-gray-500 mb-4">No reviews yet. Be the first to review!</p>
          {!showForm && (
            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center px-5 h-[42px] rounded-md bg-brand-blue text-white text-[13px] font-medium hover:bg-brand-blue-dark transition-colors"
            >
              Be the first to review
            </button>
          )}
        </div>
      )}

      {showForm && (
        <div className="border-t border-gray-100 pt-6 mt-6">
          <ReviewForm productId={productId} onSubmitted={() => setShowForm(false)} />
        </div>
      )}
    </div>
  );
}

function TrustBar({ config }: { config: any }) {
  const items = [
    { icon: <Truck size={16} />, label: `Free Delivery${config.delivery.freeDeliveryMin > 0 ? ` (over ৳${config.delivery.freeDeliveryMin.toLocaleString()})` : ''}`, key: 'delivery' },
    { icon: <Wallet size={16} />, label: 'Cash on Delivery', key: 'cod' },
    { icon: <RefreshCw size={16} />, label: 'Easy Returns', key: 'returns' },
    { icon: <ShieldCheck size={16} />, label: 'Secure Payment', key: 'payment' },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 md:mx-0 md:px-0 pb-1">
      {items.map((item) => (
        <div key={item.key} className="flex-shrink-0 flex flex-col items-center gap-1.5 bg-gray-50 rounded-lg px-4 py-3 min-w-[100px]">
          <div className="text-gray-500">{item.icon}</div>
          <span className="text-[11px] text-gray-600 text-center leading-tight font-medium">{item.label}</span>
        </div>
      ))}
    </div>
  );
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
  const [heartPop, setHeartPop] = useState(false);
  const [reviews, setReviews] = useState<Review[] | undefined>(product.reviews);
  const [descExpanded, setDescExpanded] = useState(false);
  const [showStickyOrder, setShowStickyOrder] = useState(false);
  const [qty, setQty] = useState(1);
  const ctaRef = useRef<HTMLDivElement>(null);

  const isVariable = product.type === 'variable' && (product.variants?.length ?? 0) > 0;
  const activeVariants = product.variants?.filter((v) => v.isActive && v.stock > 0) || [];

  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(() => {
    if (isVariable && activeVariants.length > 0) return activeVariants[0];
    return null;
  });
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string>>({});

  const allAttrNames = useMemo(() => {
    const names = new Set<string>();
    product.variants?.forEach(v =>
      v.attributeValues?.forEach(av => names.add(av.attributeValue.attribute.name))
    );
    return [...names];
  }, [product.variants]);

  const effectiveStock = useMemo(() => {
    if (product.manageStock !== true) return undefined;
    const variants = product.variants || [];
    const selectedCount = Object.keys(selectedAttrs).length;

    // No explicit selection: check any active variant has stock
    if (selectedCount === 0) {
      const anyStock = variants.some(v => v.isActive && v.stock > 0);
      return anyStock ? 999 : 0;
    }

    // Partial selection: find variants matching explicitly selected attrs
    if (selectedCount < allAttrNames.length) {
      const matching = variants.filter(v => {
        if (!v.isActive) return false;
        return Object.entries(selectedAttrs).every(([name, value]) =>
          v.attributeValues?.some(av =>
            av.attributeValue.attribute.name === name && av.attributeValue.value === value
          )
        );
      });
      return matching.some(v => v.stock > 0) ? 999 : 0;
    }

    // Full selection: use selected variant's stock
    return selectedVariant?.stock ?? 0;
  }, [product, selectedVariant, selectedAttrs, allAttrNames]);

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
    if (product.slug) {
      setSizeChartLoading(true);
      apiClient.get(`/size-charts/by-product/${product.slug}`)
        .then(res => setSizeChartData(res.data))
        .catch(() => {})
        .finally(() => setSizeChartLoading(false));
    }
  }, [product.slug]);

  useEffect(() => {
    if (!reviews && product.slug) {
      apiClient.get(`/reviews/product/${product.slug}`)
        .then(res => setReviews(res.data))
        .catch(() => {});
    }
  }, [product.slug, reviews]);

  useEffect(() => {
    function check() {
      if (!ctaRef.current) return;
      setShowStickyOrder(ctaRef.current.getBoundingClientRect().top < 0);
    }
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
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
  const displayStock = effectiveStock;

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
        quantity: qty,
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

  const [shareUrl, setShareUrl] = useState('');
  const shareText = encodeURIComponent(`Check out ${product.name}`);
  useEffect(() => { setShareUrl(encodeURIComponent(window.location.href)); }, []);

  const sections = product.descriptionSections;

  const waNumber = config.order?.whatsapp || config.social.whatsapp;
  const callNumber = config.order?.callNumber || config.store.phone;
  const waHref = waNumber ? `https://wa.me/${waNumber.replace(/[^0-9]/g, '')}?text=I want to order: ${product.name}${variantLabel ? ` (${variantLabel})` : ''}%0A${shareUrl}` : '#';
  const callHref = callNumber ? `tel:+${callNumber.replace(/[^0-9]/g, '')}` : '#';

  return (
    <div className="bg-white min-h-screen pb-28 md:pb-12 overflow-x-hidden">
      <style dangerouslySetInnerHTML={{__html: `
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
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease forwards;
        }
      `}} />

      <div className="px-4 py-3 flex items-center gap-2 text-[14px] overflow-x-auto hide-scrollbar">
        <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-800 transition-colors whitespace-nowrap">Home</button>
        <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
        {product.category ? (
          <>
            <button
              onClick={() => router.push(product.categorySlug ? `/products?category=${product.categorySlug}` : '/products')}
              className="text-gray-500 hover:text-gray-800 transition-colors whitespace-nowrap"
            >
              {product.category}
            </button>
            <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
          </>
        ) : (
          <>
            <button onClick={() => router.push('/products')} className="text-gray-500 hover:text-gray-800 transition-colors whitespace-nowrap">Products</button>
            <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
          </>
        )}
        <span className="text-gray-800 truncate">{product.name}</span>
      </div>

      <div className="mx-auto flex flex-col md:flex-row gap-0 md:gap-8 md:max-w-screen-xl">
        <ProductImageGallery images={itemGallery} productName={product.name} key={selectedVariant?.id || product.id} />

        <div className="flex flex-col md:w-1/2 px-4 md:px-0 pt-4 md:pt-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-[22px] md:text-[26px] text-gray-800 font-normal leading-tight mb-1">{product.name}</h1>
              {sections?.tagline && (
                <p className="text-[15px] text-brand-blue italic leading-relaxed mb-3">{sections.tagline}</p>
              )}
            </div>
            <button onClick={handleWishlistToggle}
              className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                isWishlisted(product.id)
                  ? 'bg-red-50 text-red-500'
                  : 'bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500'
              }`}>
              <Heart size={20} className={`${isWishlisted(product.id) ? 'fill-red-500' : ''} ${heartPop ? 'animate-[heartPop_300ms_ease]' : ''}`} />
            </button>
          </div>

          <div className="flex items-center gap-3 mb-1" key={`price-${displayPrice}-${selectedVariant?.id || ''}`}>
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

          <div className="mb-1 flex items-center gap-3 flex-wrap">
            <StockBadge stock={displayStock} />
            {(product.codAvailable !== false) && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#21bc5c] text-white text-[11px] font-bold leading-tight">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/>
                </svg>
                Cash on Delivery Available
              </span>
            )}
          </div>

          {product.sku && (
            <p className="text-[13px] text-gray-400 mb-3">Product Code: {product.sku}</p>
          )}

          {isVariable && product.variants && (
            <VariantSelector
              variants={product.variants}
              selectedVariant={selectedVariant}
              onSelect={setSelectedVariant}
              onSelectAttr={(name, value) => setSelectedAttrs(prev => ({ ...prev, [name]: value }))}
              sizeGuideLabel={sizeChartData ? 'Size Guide' : undefined}
              onSizeGuideClick={sizeChartData ? () => setSizeChartOpen(true) : undefined}
            />
          )}

          {!isVariable && (sizeChartLoading || sizeChartData) && (
            <div className="flex items-center gap-2 mb-4">
              {sizeChartLoading && (
                <span className="text-[13px] text-gray-400 italic">Loading size chart...</span>
              )}
              {sizeChartData && (
                <button
                  onClick={() => setSizeChartOpen(true)}
                  className="text-[12px] text-gray-400 hover:text-brand-blue flex items-center gap-1 transition-colors"
                >
                  <span>📏</span>
                  <span className="underline underline-offset-2">Size Guide</span>
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-6 mb-4">
            <span className="text-[16px] text-gray-800">Quantity:</span>
            <div className="flex items-center h-[42px] border border-gray-300 rounded-md overflow-hidden bg-white w-[130px]">
              <button onClick={() => inCart ? updateQuantity(itemKey, Math.max(1, quantity - 1)) : setQty(Math.max(1, qty - 1))}
                className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"><Minus size={18} /></button>
              <div className="flex-1 border-x border-gray-300 h-full flex items-center justify-center text-[16px] font-medium">{inCart ? quantity : qty}</div>
              <button onClick={() => inCart ? updateQuantity(itemKey, quantity + 1) : setQty(qty + 1)}
                className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"><Plus size={18} /></button>
            </div>
          </div>

          {sections?.benefits && sections.benefits.length > 0 && (
            <div className="mb-4 space-y-1.5">
              {sections.benefits.map((benefit, i) => (
                <div key={i} className="flex items-start gap-2 text-[13px] text-gray-600">
                  <span className="text-[#21bc5c] mt-0.5 flex-shrink-0">✓</span>
                  <span>{benefit}</span>
                </div>
              ))}
            </div>
          )}

          <div ref={ctaRef} className="flex flex-col gap-2 mb-6 w-full" data-cta-section>
            <button onClick={handleAddToCart}
              className={`w-full h-[44px] md:h-12 rounded-[4px] font-medium flex items-center justify-center gap-2 transition-all text-[13px] md:text-[14px] ${
                justAdded
                  ? 'bg-green-600 text-white'
                  : inCart
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'border-2 border-brand-blue text-brand-blue bg-white hover:bg-brand-blue/5'
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
              className="w-full h-[44px] md:h-12 rounded-[4px] bg-brand-blue hover:bg-brand-blue-dark text-white font-bold flex items-center justify-center gap-2 transition-colors text-[14px] md:text-[15px] tracking-wide">
              ORDER NOW
            </button>
          </div>

          <div className="mb-6">
            <TrustBar config={config} />
          </div>

          <div className="mb-6 flex items-center gap-3">
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
      </div>

      <div className="px-4 max-w-screen-xl mx-auto">
        {sections?.specifications && (
          <div className="border-t border-gray-100 pt-6 mb-6 animate-fadeIn">
            <h3 className="text-[16px] font-semibold text-gray-800 mb-3">Details</h3>
            <div className="text-[13px] text-gray-500 leading-relaxed" dangerouslySetInnerHTML={{
              __html: sanitizeHTML(sections.specifications)
            }} />
          </div>
        )}

        {sections?.stylingTip && (
          <div className="mb-6 animate-fadeIn">
            <p className="text-[13px] text-gray-400 italic flex items-start gap-2">
              <span>💡</span>
              <span>{sections.stylingTip}</span>
            </p>
          </div>
        )}

        {product.description && (
          <div className="border-t border-gray-100 pt-6 mb-6">
            <button
              onClick={() => setDescExpanded(!descExpanded)}
              className="w-full flex items-center justify-between text-[16px] font-semibold text-gray-800 mb-0"
            >
              <span>Description</span>
              {descExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {descExpanded && (
              <div className="text-[14px] text-gray-600 leading-relaxed pt-3 animate-fadeIn" dangerouslySetInnerHTML={{
                __html: sanitizeHTML(product.description)
              }} />
            )}
          </div>
        )}

        {sections?.seoTags && sections.seoTags.length > 0 && (
          <div className="border-t border-gray-100 pt-6 mb-6">
            <details className="group">
              <summary className="text-[12px] text-gray-400 cursor-pointer list-none flex items-center gap-1 hover:text-gray-600 transition-colors">
                <span>Related Searches</span>
                <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
              </summary>
              <div className="flex flex-wrap gap-2 mt-3">
                {sections.seoTags.map((tag, i) => (
                  <button
                    key={i}
                    onClick={() => router.push(`/products?search=${encodeURIComponent(tag)}`)}
                    className="inline-flex items-center px-3 py-1 bg-gray-100 hover:bg-gray-200 text-[12px] text-gray-500 rounded-full transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </details>
          </div>
        )}

        <ReviewsSection reviews={reviews} productId={product.id} />
      </div>

      {product.tags && product.tags.length > 0 && !sections?.seoTags && (
        <div className="px-4 max-w-screen-xl mx-auto mb-6">
          <details className="group">
            <summary className="text-[12px] text-gray-400 cursor-pointer list-none flex items-center gap-1 hover:text-gray-600 transition-colors">
              <span>Related Searches</span>
              <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
            </summary>
            <div className="flex flex-wrap gap-2 mt-3">
              {product.tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => router.push(`/products?search=${encodeURIComponent(tag)}`)}
                  className="inline-flex items-center px-3 py-1 bg-gray-100 hover:bg-gray-200 text-[12px] text-gray-500 rounded-full transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}

      <SizeChartModal open={sizeChartOpen} onClose={() => setSizeChartOpen(false)} sizeChart={sizeChartData} />

      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] pb-safe md:hidden">
        <div className="flex items-stretch gap-1.5 px-3 py-2 max-w-screen-xl mx-auto">
          <a href={callHref}
            className={`w-[50px] flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-brand-blue hover:border-brand-blue transition-all active:scale-95 flex-shrink-0 ${!callNumber ? 'opacity-30 pointer-events-none' : ''}`}
            aria-label="Call to order"
          >
            <Phone size={20} strokeWidth={2} />
          </a>

          <a href={waHref}
            target="_blank" rel="noreferrer"
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg text-white text-[14px] font-semibold transition-all active:scale-[0.98] ${!waNumber ? 'opacity-50 pointer-events-none' : ''}`}
            style={{ backgroundColor: '#25D366' }}
          >
            <WhatsAppIcon />
            <span>WhatsApp</span>
          </a>

          {showStickyOrder && (
            <button onClick={handleBuyNow}
              className="flex-[1.5] rounded-lg bg-brand-blue text-white text-[14px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] hover:bg-brand-blue-dark"
            >
              <ShoppingBag size={16} strokeWidth={2.5} />
              <span>Order Now</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
