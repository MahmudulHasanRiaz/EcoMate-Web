"use client";

import React from 'react';
import { ShoppingCart, Heart } from "lucide-react";
import Image from "next/image";
import Link from 'next/link';
import type { Product } from "@/lib/types";
import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/context/WishlistContext";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { PLACEHOLDER_IMAGE, PRODUCT_BLUR_DATA_URL } from "@/lib/constants";
import { trackEvent } from "@/lib/tracking";
import { getAspectStyle } from "@/lib/utils/image-ratio";
import { VariantPickerModal } from '@/components/VariantPickerModal';

interface ProductCardProps {
  product: Product;
  index?: number;
}

const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;

export default function ProductCard({ product, index = 99 }: ProductCardProps) {
  const { items, addToCart, updateQuantity } = useCart();
  const { config } = useStorefrontConfig();
  const { isWishlisted, toggle } = useWishlist();
  const [retryKey, setRetryKey] = React.useState(0);
  const [imageFailed, setImageFailed] = React.useState(false);
  const retriesRef = React.useRef(0);

  React.useEffect(() => {
    retriesRef.current = 0;
    setRetryKey(0);
    setImageFailed(false);
  }, [product.image, product.id]);

  const handleImageError = () => {
    if (retriesRef.current < MAX_RETRIES) {
      retriesRef.current++;
      setTimeout(() => setRetryKey(k => k + 1), RETRY_DELAY);
    } else {
      setImageFailed(true);
    }
  };

  const isVar = product.type === 'variable' && (product.variants?.length ?? 0) > 0;

  const cartItem = items.find((item) => item.id === product.id);
  const inCart = !!cartItem && !isVar;
  const quantity = cartItem?.quantity ?? 0;
  const isPriority = index < 6;

  const [variantPickerOpen, setVariantPickerOpen] = React.useState(false);
  const [flyTarget, setFlyTarget] = React.useState<{ x: number; y: number } | undefined>(undefined);

  const handleAddToCart = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isVar) {
      const rect = e.currentTarget.getBoundingClientRect();
      setFlyTarget({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      setVariantPickerOpen(true);
      return;
    }
    const img = document.getElementById(`img-${product.id}`);
    let x = 0, y = 0;
    if (img) {
      const rect = img.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
    window.dispatchEvent(new CustomEvent('fly-to-cart', {
      detail: { x, y, image: product.image || PLACEHOLDER_IMAGE }
    }));
    trackEvent('AddToCart', {
      content_ids: [product.id],
      value: product.price,
      currency: config.currency.code,
      contents: [{ id: product.id, quantity: 1, item_price: product.price }]
    });
    addToCart({
      id: product.id,
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice,
      image: product.image,
      quantity: 1,
      slug: product.slug,
      category: product.category,
    });
  };

  const linkUrl = product.slug ? `/products/${product.slug}` : `/products/${product.id}`;
  const aspect = getAspectStyle(config.catalogImageRatio);
  const isOos = product.availabilityMode === 'ALWAYS_OUT_OF_STOCK' || (product.stock != null && product.stock <= 0)

  return (
    <div className="bg-white rounded-[8px] overflow-hidden flex flex-col h-full border border-gray-200 relative group transition-all select-none">
      {(product.saveAmount && product.originalPrice) && (
        <div className="absolute top-2 right-2 bg-brand-success-dark text-white text-[10px] md:text-[11px] px-2 py-0.5 rounded-sm z-10 font-bold shadow-sm">
          Save {Math.round((product.saveAmount / product.originalPrice) * 100)}%
        </div>
      )}
      {(product.availabilityMode === 'ALWAYS_OUT_OF_STOCK' || (product.stock != null && product.stock <= 0)) && (
        <div className="absolute top-2 left-12 z-10">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            Out of Stock
          </span>
        </div>
      )}

      <Link href={linkUrl} className={`relative w-full ${aspect.className} bg-gray-50 flex items-center justify-center p-0 cursor-pointer overflow-hidden select-none`}
        style={'style' in aspect ? aspect.style : undefined}
        scroll={true}>
        {!product.image ? (
          <Image
            src={PLACEHOLDER_IMAGE}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain pointer-events-none"
            unoptimized
          />
        ) : (
          <Image
            key={retryKey}
            id={`img-${product.id}`}
            src={product.image}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            priority={isPriority}
            fetchPriority={isPriority ? "high" : "auto"}
            loading={isPriority ? "eager" : "lazy"}
            decoding="async"
            placeholder="blur"
            blurDataURL={PRODUCT_BLUR_DATA_URL}
            className={`object-contain transition-transform duration-500 group-hover:scale-105 pointer-events-none ${imageFailed ? 'opacity-60' : ''}`}
            onError={handleImageError}
          />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); toggle(product.id); }}
          aria-label={isWishlisted(product.id) ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          className={`absolute top-2 left-2 w-8 h-8 rounded-full flex items-center justify-center transition-all z-10 ${
            isWishlisted(product.id)
              ? 'bg-red-500 text-white shadow-md'
              : 'bg-white/80 text-gray-400 hover:text-red-500 hover:bg-white'
          }`}>
          <Heart size={16} className={isWishlisted(product.id) ? 'fill-white' : ''} />
        </button>
      </Link>

      <div className="p-2 md:p-3 flex flex-col flex-1 bg-white">
        <Link href={linkUrl} className="text-[12px] md:text-[14px] text-gray-800 line-clamp-2 mb-2 font-medium leading-normal cursor-pointer hover:text-brand-blue transition-colors min-h-[2.2rem] md:min-h-[2.5rem]"
          scroll={true}>
          {product.name}
        </Link>

        <div className="mt-auto space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {product.priceRange ? (
              <span className="text-[15px] md:text-[18px] font-black text-brand-blue-text">{config.currency.symbol}{product.priceRange.min.toLocaleString()} – {config.currency.symbol}{product.priceRange.max.toLocaleString()}</span>
            ) : (
              <>
                {isVar && <span className="text-[11px] text-gray-500 font-medium">From</span>}
                <span className="text-[15px] md:text-[18px] font-black text-brand-blue-text">{config.currency.symbol}{product.price.toLocaleString()}</span>
              </>
            )}
            {product.originalPrice && (
              <span className="text-[12px] md:text-[14px] font-medium text-gray-500 line-through">{config.currency.symbol}{product.originalPrice.toLocaleString()}</span>
            )}
          </div>

          {inCart ? (
            <div className="flex items-center h-[34px] md:h-[40px] w-full border-2 border-brand-blue/20 rounded-lg overflow-hidden">
              <button onClick={() => updateQuantity(product.id, quantity - 1)}
                className="w-10 h-full bg-white text-brand-blue-text border-r border-brand-blue/10 flex items-center justify-center font-black hover:bg-brand-blue/5 transition-colors">-</button>
              <div className="flex-1 h-full flex items-center justify-center font-black text-brand-blue-text bg-brand-blue/5 text-[14px]">{quantity}</div>
              <button onClick={() => updateQuantity(product.id, quantity + 1)}
                className="w-10 h-full bg-white text-brand-blue-text border-l border-brand-blue/10 flex items-center justify-center font-black hover:bg-brand-blue/5 transition-colors">+</button>
            </div>
          ) : isOos ? (
            <button disabled
              className="w-full h-[34px] md:h-[40px] bg-gray-100 text-gray-400 font-bold text-[12px] md:text-[13px] rounded-lg flex items-center justify-center gap-2 cursor-not-allowed">
              Out of Stock
            </button>
          ) : (
            <button onClick={handleAddToCart}
              className="w-full h-[34px] md:h-[40px] bg-white text-brand-blue-text font-bold text-[12px] md:text-[13px] border-2 border-brand-blue/20 rounded-lg flex items-center justify-center gap-2 hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all group/btn">
              <ShoppingCart size={16} strokeWidth={2.5} className="group-hover/btn:scale-110 transition-transform" />
              {isVar ? 'ADD TO CART' : 'ADD TO CART'}
            </button>
          )}
        </div>
      </div>
      <VariantPickerModal
        product={product}
        open={variantPickerOpen}
        onClose={() => setVariantPickerOpen(false)}
        flyTarget={flyTarget}
      />
    </div>
  );
}
