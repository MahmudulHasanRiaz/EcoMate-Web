"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronRight, Star } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import type { Product, Variant, Review } from "@/lib/types";
import { trackAddToCart, trackViewContent } from "@/lib/tracking";
import { resolveCatalogId } from '@/lib/catalog-id';
import { resolveVariantImage, parentImage } from '@/lib/variant-image';
import { useAuth } from "@/context/AuthContext";
import RelatedProducts from "./RelatedProducts";
import apiClient from "@/lib/api-client";
import type { SizeChartData } from "./SizeChartModal";
import { toast } from 'sonner';
import { PdpGallery } from "./pdp/PdpGallery";
import { BuyBox } from "./pdp/BuyBox";
import { PdpSections } from "./pdp/PdpSections";
import { StickyBar } from "./pdp/StickyBar";
import dynamic from "next/dynamic";

// Below-the-fold / on-demand sheets stay out of the initial PDP bundle and
// load on first open (ssr:false — they need browser APIs anyway). The
// trigger buttons render immediately; only the sheet content is deferred.
function SheetLoading() {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center min-[901px]:items-center" aria-hidden="true">
      <div className="w-8 h-8 m-auto border-2 border-gray-200 border-t-brand-blue rounded-full animate-spin" />
    </div>
  );
}
const CartVariantSheet = dynamic(
  () => import("./pdp/CartVariantSheet").then((m) => m.CartVariantSheet),
  { ssr: false, loading: SheetLoading },
);
const SizeGuideSheet = dynamic(
  () => import("./pdp/SizeGuideSheet").then((m) => m.SizeGuideSheet),
  { ssr: false, loading: SheetLoading },
);
const ReviewModal = dynamic(
  () => import("./pdp/ReviewModal").then((m) => m.ReviewModal),
  { ssr: false, loading: SheetLoading },
);

function cartItemKey(productId: string, variantId?: string) {
  return variantId ? `${productId}::${variantId}` : productId;
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

function ReviewsSection({ reviews, productId, productName, userLabel, onRefresh }: { reviews?: Review[]; productId: string; productName: string; userLabel: string | null; onRefresh: () => void }) {
  const [reviewOpen, setReviewOpen] = useState(false);

  const hasReviews = reviews && reviews.length > 0;
  // Unrated reviews (rating null) never inflate the average.
  const rated = hasReviews ? reviews.filter((r) => r.rating != null) : [];
  const avgRating = rated.length ? rated.reduce((sum, r) => sum + (r.rating ?? 0), 0) / rated.length : 0;
  const totalReviews = hasReviews ? reviews.length : 0;

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-[14px]">
        <h2 className="text-[19px] font-medium text-brand-dark m-0">Customer Reviews</h2>
        <button
          onClick={() => setReviewOpen(true)}
          className="h-[38px] px-[14px] border border-brand-border rounded-[3px] text-[13px] font-semibold tracking-wide text-brand-dark bg-white hover:border-brand-blue hover:text-brand-blue transition-colors min-h-[44px] min-[901px]:min-h-0"
        >
          WRITE A REVIEW
        </button>
      </div>

      {hasReviews ? (
        <>
          <div className="flex items-center gap-4 mb-6 p-4 bg-gray-50 rounded-[3px]">
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
                <StarRating rating={review.rating ?? 0} size={14} />
                {review.text && <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">{review.text}</p>}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-10 px-4 bg-gray-50 rounded-[3px] mb-4">
          <Star size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-[14px] text-gray-500">No reviews yet. Be the first to review this product.</p>
        </div>
      )}

      {reviewOpen && (
        <ReviewModal
          productId={productId}
          productName={productName}
          userLabel={userLabel}
          onSubmitted={onRefresh}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}

export default function ProductDetailClient({ product, defaultColor, initialRelatedItems, initialReviews, sanitizedDescription, sanitizedSpecifications }: {
  product: Product;
  defaultColor?: string;
  // SSR-provided data (page.tsx fetches these in parallel with the product).
  // When present, the matching client fetch is skipped — no browser waterfall.
  initialRelatedItems?: Product[];
  initialReviews?: Review[];
  // Server-sanitized HTML (required — keeps dompurify out of the client bundle).
  sanitizedDescription: string;
  sanitizedSpecifications: string;
}) {
  const { items, addToCart, updateQuantity, startBuyNow } = useCart();
  const { config } = useStorefrontConfig();
  const { isWishlisted, toggle } = useWishlist();
  const { user } = useAuth();
  const router = useRouter();
  const [sizeChartOpen, setSizeChartOpen] = useState(false);
  const [sizeChartData, setSizeChartData] = useState<SizeChartData | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sizeChartLoading, setSizeChartLoading] = useState(false);
  const [heartPop, setHeartPop] = useState(false);
  const [reviews, setReviews] = useState<Review[] | undefined>(initialReviews ?? product.reviews);
  const [qty, setQty] = useState(1);
  const [showSizeHint, setShowSizeHint] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetHint, setSheetHint] = useState<string | null>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);

  const isVariable = product.type === 'variable' && (product.variants?.length ?? 0) > 0;
  const activeVariants = product.variants?.filter((v) => v.isActive && v.stock > 0) || [];

  const COLOR_ATTR_KEYWORDS = ['color', 'colour', 'clr', 'কালার', 'কালার্', 'রং', 'রঙ', 'ক্‌লার'];

  const colorAttrName = useMemo(() => {
    if (!defaultColor) return null;
    const names = new Set<string>();
    product.variants?.forEach(v =>
      v.attributeValues?.forEach(av => names.add(av.attributeValue.attribute.name))
    );
    for (const name of names) {
      const lower = name.toLowerCase();
      if (COLOR_ATTR_KEYWORDS.some(k => lower.includes(k))) {
        return name;
      }
    }
    return null;
  }, [product.variants, defaultColor]);

  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string>>(
    () => {
      if (!colorAttrName || !defaultColor) return {};
      // Find matching color value case-insensitively among variants
      const colorValues = new Set<string>();
      product.variants?.forEach(v =>
        v.attributeValues?.forEach(av => {
          if (av.attributeValue.attribute.name === colorAttrName) {
            colorValues.add(av.attributeValue.value);
          }
        })
      );
      // exact match first
      if (colorValues.has(defaultColor)) {
        return { [colorAttrName]: defaultColor };
      }
      // case-insensitive fallback
      const ci = [...colorValues].find(v => v.toLowerCase() === defaultColor.toLowerCase());
      if (ci) return { [colorAttrName]: ci };
      return {};
    }
  );
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    if (colorAttrName && defaultColor) {
      // defaultColor pre-selected — skip auto-select, user picks size
      // But if all attrs already selected (color-only product), find matching variant
      const allNames = new Set<string>();
      product.variants?.forEach(v =>
        v.attributeValues?.forEach(av => allNames.add(av.attributeValue.attribute.name))
      );
      if (Object.keys(selectedAttrs).length === allNames.size) {
        const match = activeVariants.find(v =>
          v.attributeValues.every(av => selectedAttrs[av.attributeValue.attribute.name] === av.attributeValue.value)
        );
        if (match) setSelectedVariant(match);
      }
      setSettingsLoaded(true);
      return;
    }
    if (!isVariable || activeVariants.length === 0) {
      setSettingsLoaded(true);
      return;
    }
    if (config.features.defaultVariantSelected === false) {
      setSelectedVariant(null);
      setSelectedAttrs({});
      setSettingsLoaded(true);
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      setSelectedVariant(activeVariants[0]);
      setSettingsLoaded(true);
      return;
    }
    import('@/lib/api/settings').then(({ getSettings }) => {
      getSettings().then(s => {
        if (s.autoVariantSelect !== false) {
          setSelectedVariant(activeVariants[0]);
        }
        setSettingsLoaded(true);
      }).catch(() => {
        setSelectedVariant(activeVariants[0]);
        setSettingsLoaded(true);
      });
    });
  }, []);

  const allAttrNames = useMemo(() => {
    const names = new Set<string>();
    product.variants?.forEach(v =>
      v.attributeValues?.forEach(av => names.add(av.attributeValue.attribute.name))
    );
    return [...names];
  }, [product.variants]);

  const handleSelectAttr = (attrName: string, value: string) => {
    const newAttrs = { ...selectedAttrs, [attrName]: value };
    setSelectedAttrs(newAttrs);
    setShowSizeHint(false);

    if (Object.keys(newAttrs).length === allAttrNames.length) {
      const match = activeVariants.find(v =>
        v.attributeValues.every(av => newAttrs[av.attributeValue.attribute.name] === av.attributeValue.value)
      );
      setSelectedVariant(match || null);
    } else {
      setSelectedVariant(null);
    }
  };

  function missingSelectionMessage(): string | null {
    if (!isVariable || selectedVariant) return null;
    const missingAttrs = allAttrNames.filter(name => !selectedAttrs[name]);
    if (missingAttrs.length === 0) return null;
    return missingAttrs.map(name => {
      if (name.toLowerCase().includes('color') || name.toLowerCase().includes('colour') || name.includes('রং') || name.includes('কালার')) return 'কালার';
      if (name.toLowerCase().includes('size') || name.includes('সাইজ') || name.includes('মাপ')) return 'সাইজ';
      return name;
    }).join(' ও ') + ' সিলেক্ট করুন';
  }

  const effectiveStock = useMemo(() => {
    const isTracked =
      product.availabilityMode === 'INVENTORY_CONTROLLED' ||
      product.availabilityMode === 'MANAGED_STOCK' ||
      product.manageStock === true;

    if (!isTracked) return undefined;
    if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') return 0;
    if (product.availabilityMode === 'ALWAYS_IN_STOCK') return undefined;

    // Simple product
    if (!isVariable) {
      return product.stock ?? 0;
    }

    // Variable product
    const variants = product.variants || [];
    const selectedCount = Object.keys(selectedAttrs).length;

    // No explicit selection: sum stock of all active variants
    if (selectedCount === 0) {
      return variants.reduce((sum, v) => sum + (v.isActive ? (v.stock ?? 0) : 0), 0);
    }

    // Partial selection: sum stock of matching active variants
    if (selectedCount < allAttrNames.length) {
      const matching = variants.filter(v => {
        if (!v.isActive) return false;
        return Object.entries(selectedAttrs).every(([name, value]) =>
          v.attributeValues?.some(av =>
            av.attributeValue.attribute.name === name && av.attributeValue.value === value
          )
        );
      });
      return matching.reduce((sum, v) => sum + (v.stock ?? 0), 0);
    }

    // Full selection: use selected variant's stock
    return selectedVariant?.stock ?? 0;
  }, [product, selectedVariant, selectedAttrs, allAttrNames, isVariable]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // ViewContent represents the Product Detail Page view itself — NOT variant
  // selection. It fires exactly ONCE per product-page lifecycle, immediately on
  // open, keyed by product.id: variant changes, re-selection, option edits,
  // rerenders, and price/image/availability updates must never re-fire (they
  // are interactions inside the same view, not new page views). A genuinely
  // new product (id change, including client navigation that swaps the product
  // prop without remounting) fires a new event with a new logical event_id.
  //
  // Identity: the PARENT product catalog id (product.sku || product.id) with
  // content_type 'product'. The Meta catalog's variant items are matched by
  // AddToCart/Purchase (which carry the resolved variant SKU); the page view
  // itself is the parent product and must not be redefined per variant.
  // Known trade-off: the feed emits variant rows only, so a parent SKU matches
  // no single catalog row — accepted because inventing a viewed variant would
  // fabricate the event. The product prop is server-rendered complete (sku
  // present on first client render), so the fired identity is final; a later
  // login enriches the same event server-side via mirror enrichment.
  const lastViewedProductRef = useRef<string>('');
  useEffect(() => {
    if (!product?.id || lastViewedProductRef.current === product.id) return;
    lastViewedProductRef.current = product.id;
    trackViewContent({
      contentId: resolveCatalogId(product, null),
      contentName: product.name,
      contentCategory: product.category,
      value: product.price,
      currency: config.currency.code,
      email: user?.email,
      phone: user?.phoneNumber || undefined,
      name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
      country: 'BD',
    });
  }, [product.id, product.name, product.category, product.price, product.sku, config.currency.code, user?.email, user?.phoneNumber, user?.firstName, user?.lastName]);

  // Size charts load lazily on first guide open — never on PDP mount.
  // The trigger visibility comes from the feature flag (sizeGuideAvailable);
  // existence for this product is confirmed by the fetch below.
  const sizeChartFetchedSlug = useRef<string | null>(null);
  const sizeGuideAvailable = config.features.sizeChart && !!product.slug;

  function openSizeGuide() {
    const slug = product.slug;
    if (!config.features.sizeChart || !slug) return;
    if (sizeChartFetchedSlug.current === slug) {
      if (sizeChartData) setSizeChartOpen(true);
      else toast.info('No size guide available for this product.');
      return;
    }
    sizeChartFetchedSlug.current = slug;
    setSizeChartLoading(true);
    apiClient.get(`/size-charts/by-product/${slug}`)
      .then(res => {
        const chart = res.data ?? null;
        setSizeChartData(chart);
        if (chart) setSizeChartOpen(true);
        else toast.info('No size guide available for this product.');
      })
      .catch(() => {
        sizeChartFetchedSlug.current = null;
        setSizeChartData(null);
        toast.info('No size guide available for this product.');
      })
      .finally(() => setSizeChartLoading(false));
  }

  function refreshReviews() {
    if (!product.slug) return;
    const controller = new AbortController();
    apiClient.get(`/reviews/product/${product.slug}`, { signal: controller.signal })
      .then(res => { if (!controller.signal.aborted) setReviews(Array.isArray(res.data) ? res.data : (res.data as any)?.data ?? []); })
      .catch(() => {});
  }

  useEffect(() => {
    if (reviews || !product.slug) return;
    refreshReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.slug]);

  function handleSheetOpen() {
    setSheetHint(null);
    setSheetOpen(true);
  }

  // Sticky bar appears only once the buy-box CTAs scroll out of view
  // (mockup mbar) — never as a duplicate while the CTAs are visible.
  useEffect(() => {
    function check() {
      const cta = document.querySelector('[data-testid="buy-box"] [data-cta]');
      if (!cta) {
        setShowStickyBar(false);
        return;
      }
      setShowStickyBar(cta.getBoundingClientRect().bottom < 0);
    }
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);

  function handleSheetAdd() {
    const msg = missingSelectionMessage();
    if (msg) {
      const sizeMissing = allAttrNames.some(name => !selectedAttrs[name] && (name.toLowerCase().includes('size') || name.includes('সাইজ') || name.includes('মাপ')));
      setSheetHint(sizeMissing ? 'Please select a size to continue.' : msg);
      return;
    }
    handleAddToCart();
  }

  function handleSheetBuy() {
    const msg = missingSelectionMessage();
    if (msg) {
      const sizeMissing = allAttrNames.some(name => !selectedAttrs[name] && (name.toLowerCase().includes('size') || name.includes('সাইজ') || name.includes('মাপ')));
      setSheetHint(sizeMissing ? 'Please select a size to continue.' : msg);
      return;
    }
    setSheetOpen(false);
    handleBuyNow();
  }

  function handleSizeGuidePick(size: string) {
    const sizeAttr = allAttrNames.find(name =>
      name.toLowerCase().includes('size') || name.includes('সাইজ') || name.includes('মাপ') || name.includes('আকার'),
    );
    if (sizeAttr) handleSelectAttr(sizeAttr, size);
    setSizeChartOpen(false);
  }

  const variantLabel = selectedVariant
    ? selectedVariant.attributeValues?.map((av) => av.attributeValue.value).join(' / ')
    : undefined;

  const variantAttributes = selectedVariant
    ? selectedVariant.attributeValues?.map((av) => ({
        name: av.attributeValue.attribute.name,
        value: av.attributeValue.value,
      }))
    : undefined;

  const displayPrice = selectedVariant?.price ?? product.price;
  const variantRegPrice = selectedVariant?.regularPrice;
  const refPrice = product.originalPrice ?? product.basePrice;
  const displayOriginalPrice = (selectedVariant != null)
    ? (variantRegPrice != null && variantRegPrice > displayPrice
      ? variantRegPrice
      : refPrice != null && refPrice > displayPrice
        ? refPrice
        : undefined)
    : (product.originalPrice && product.originalPrice > displayPrice ? product.originalPrice : undefined);
  const displayImage = resolveVariantImage(selectedVariant, product);
  const parentImg = parentImage(product);
  const variantImages = selectedVariant?.images?.length ? selectedVariant.images : undefined;
  const displayStock = effectiveStock;
  const isOutOfStock = displayStock !== undefined && displayStock <= 0;

  const itemGallery: string[] = isVariable
    ? (variantImages || [displayImage ?? '', ...(product.images?.slice(1) || [])]).filter((u): u is string => !!u)
    : [product.image ?? '', ...(product.images?.slice(1) || [])].filter((u): u is string => !!u);

  const itemKey = cartItemKey(product.id, selectedVariant?.id);
  const cartItem = items.find((item) => {
    if (selectedVariant) return item.variantId === selectedVariant.id && item.id === product.id;
    return item.id === product.id;
  });
  const inCart = !!cartItem;
  const quantity = cartItem?.quantity || 1;

  function handleAddToCart() {
    if (isOutOfStock) return;
    // ADDED-feedback window (1.5s): ignore repeat clicks — cart state may
    // still be propagating, and a stale inCart read would remove the item
    // the user just added.
    if (justAdded) return;
    const msg = missingSelectionMessage();
    if (msg) {
      setShowSizeHint(true);
      toast.error(msg);
      return;
    }
    if (inCart) {
      updateQuantity(itemKey, 0);
    } else {
      addToCart({
        id: product.id,
        name: product.name,
        price: displayPrice,
        originalPrice: displayOriginalPrice,
        image: displayImage,
        productImage: parentImg,
        quantity: qty,
        variantId: selectedVariant?.id,
        variantLabel,
        variantAttributes,
        stock: displayStock,
        catalogId: resolveCatalogId(product, selectedVariant),
      });
      trackAddToCart({
        contentId: resolveCatalogId(product, selectedVariant),
        contentName: product.name,
        contentCategory: product.category,
        unitPrice: displayPrice,
        quantityAdded: qty,
        currency: config.currency.code,
        email: user?.email,
        phone: user?.phoneNumber || undefined,
        name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
        country: 'BD',
      });
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1500);
    }
  }

  function handleBuyNow() {
    if (isOutOfStock) return;
    const msg = missingSelectionMessage();
    if (msg) {
      setShowSizeHint(true);
      toast.error(msg);
      return;
    }
    // Buy Now checks out exactly one unit of this product/variant in an
    // isolated single-item flow — the shared cart is never touched, so
    // repeat clicks can never merge quantities and other cart items never
    // leak into the Buy Now order.
    startBuyNow({
      id: product.id,
      name: product.name,
      price: displayPrice,
      originalPrice: displayOriginalPrice,
      image: displayImage,
      productImage: parentImg,
      quantity: 1,
      variantId: selectedVariant?.id,
      variantLabel,
      variantAttributes,
      stock: displayStock,
      catalogId: resolveCatalogId(product, selectedVariant),
    });
    // Client-side navigation (same as the cart flow): no full-page reload,
    // so the app shell, providers and buy-now state carry over instantly.
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

  const sizeValues = useMemo(() => {
    const vals = new Set<string>();
    product.variants?.forEach((v) =>
      v.attributeValues?.forEach((av) => {
        const n = av.attributeValue.attribute.name;
        if (n.toLowerCase().includes('size') || n.includes('সাইজ') || n.includes('মাপ') || n.includes('আকার')) {
          vals.add(av.attributeValue.value);
        }
      }),
    );
    return [...vals];
  }, [product.variants]);

  const userLabel =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || null;

  const sections = product.descriptionSections;

  const waNumber = config.order?.whatsapp || config.social.whatsapp;
  const callNumber = config.order?.callNumber || config.store.phone;
  // WhatsApp order text: quantity first, then bold name/code, the selected
  // variants (color/size when chosen), and the product link last — plus a
  // ready-made "I want to order" line so the shopper just presses send.
  const waMessage = [
    'I want to order this product:',
    `*${product.name}*`,
    `*Code:* ${product.sku || 'N/A'}`,
    `*Quantity:* ${inCart ? quantity : qty}`,
    ...(variantAttributes?.map((a) => `*${a.name}:* ${a.value}`) || []),
  ].join('\n');
  const waHref = waNumber ? `https://wa.me/${waNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`${waMessage}\n${decodeURIComponent(shareUrl || '')}`)}` : '#';
  const callHref = callNumber ? `tel:+${callNumber.replace(/[^0-9]/g, '')}` : '#';

  return (
    <div className="bg-white min-h-screen pb-28 min-[901px]:pb-12 overflow-x-clip font-[var(--font-pdp)]">
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

      <div className="max-w-screen-xl mx-auto px-4 min-[901px]:px-6 py-3 flex items-center gap-2 text-[14px] overflow-x-auto hide-scrollbar">
        <Link href="/" className="text-gray-500 hover:text-gray-800 transition-colors whitespace-nowrap">Home</Link>
        <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
        {product.category ? (
          <>
            <Link
              href={product.categorySlug ? `/products?category=${product.categorySlug}` : '/products'}
              className="text-gray-500 hover:text-gray-800 transition-colors whitespace-nowrap"
            >
              {product.category}
            </Link>
            <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
          </>
        ) : (
          <>
            <Link href="/products" className="text-gray-500 hover:text-gray-800 transition-colors whitespace-nowrap">Products</Link>
            <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
          </>
        )}
        <span className="text-gray-800 truncate">{product.name}</span>
      </div>

      <div className="mx-auto grid min-[901px]:grid-cols-[1.05fr_1fr] gap-5 min-[901px]:gap-12 min-[901px]:px-6 min-[901px]:max-w-screen-xl">
        <PdpGallery
          images={itemGallery}
          productName={product.name}
          mediaMeta={product.mediaMeta}
          fallbackImage={parentImg}
          galleryKey={selectedVariant?.id || product.id}
        />

        <div className="min-[901px]:sticky min-[901px]:top-4 self-start min-w-0">
          <BuyBox
            product={product}
            config={config}
            isVariable={isVariable}
            colorAttrName={colorAttrName}
            defaultColor={defaultColor}
            selectedVariant={selectedVariant}
            selectedAttrs={selectedAttrs}
            displayPrice={displayPrice}
            displayOriginalPrice={displayOriginalPrice}
            displayStock={displayStock}
            isOutOfStock={isOutOfStock}
            qty={qty}
            quantity={quantity}
            inCart={inCart}
            justAdded={justAdded}
            sizeChartData={sizeChartData}
            sizeChartLoading={sizeChartLoading}
            sizeGuideAvailable={sizeGuideAvailable}
            showSizeHint={showSizeHint}
            wishlisted={isWishlisted(product.id)}
            heartPop={heartPop}
            copied={copied}
            shareUrl={shareUrl}
            shareText={shareText}
            waHref={waHref}
            callHref={callHref}
            waNumber={waNumber}
            callNumber={callNumber}
            onSelectVariant={setSelectedVariant}
            onSelectAttr={handleSelectAttr}
            onDec={() => inCart ? updateQuantity(itemKey, Math.max(1, quantity - 1)) : setQty(Math.max(1, qty - 1))}
            onInc={() => inCart ? updateQuantity(itemKey, quantity + 1) : setQty(qty + 1)}
            onAddToCart={handleAddToCart}
            onBuyNow={handleBuyNow}
            onWishlist={handleWishlistToggle}
            onCopyLink={handleCopyLink}
            onSizeGuide={openSizeGuide}
          />
        </div>
      </div>

      <div className="px-4 min-[901px]:px-6 max-w-screen-xl mx-auto">
        <PdpSections product={product} sizeValues={sizeValues} sanitizedDescription={sanitizedDescription} sanitizedSpecifications={sanitizedSpecifications} />

        <div className="hidden" aria-hidden="true">
          {sections?.seoTags && sections.seoTags.length > 0 && (
            <div>
              {sections.seoTags.map((tag, i) => (
                <span key={i}>{tag}, </span>
              ))}
            </div>
          )}
          {product.tags && product.tags.length > 0 && (
            <div>
              {product.tags.map((tag) => (
                <span key={tag}>{tag}, </span>
              ))}
            </div>
          )}
        </div>

        {config.features.showReviews !== false && (
          <ReviewsSection
            reviews={reviews}
            productId={product.id}
            productName={product.name}
            userLabel={userLabel}
            onRefresh={refreshReviews}
          />
        )}
      </div>

      {product.showRelatedProducts !== false && (
        <RelatedProducts product={product} initialItems={initialRelatedItems} />
      )}

      {sizeChartOpen && sizeChartData && (
        <SizeGuideSheet
          chart={sizeChartData}
          onPickSize={handleSizeGuidePick}
          onClose={() => setSizeChartOpen(false)}
        />
      )}

      {sheetOpen && (
        <CartVariantSheet
          product={product}
          displayPrice={displayPrice}
          selectedVariant={selectedVariant}
          selectedAttrs={selectedAttrs}
          qty={qty}
          quantity={quantity}
          inCart={inCart}
          justAdded={justAdded}
          hintText={sheetHint}
          isVariable={isVariable}
          colorAttrName={colorAttrName}
          defaultColor={defaultColor}
          sizeChartData={sizeChartData}
          sizeGuideAvailable={sizeGuideAvailable}
          onSelectVariant={setSelectedVariant}
          onSelectAttr={handleSelectAttr}
          onDec={() => inCart ? updateQuantity(itemKey, Math.max(1, quantity - 1)) : setQty(Math.max(1, qty - 1))}
          onInc={() => inCart ? updateQuantity(itemKey, quantity + 1) : setQty(qty + 1)}
          onAddToCart={handleSheetAdd}
          onBuyNow={handleSheetBuy}
          onSizeGuide={openSizeGuide}
          onClose={() => setSheetOpen(false)}
        />
      )}

      <StickyBar isOutOfStock={isOutOfStock} visible={showStickyBar} onOpenSheet={handleSheetOpen} />
    </div>
  );
}
