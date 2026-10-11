"use client";

import { Heart, Minus, Plus, ShoppingBag, Check, X, Truck, RefreshCw, ShieldCheck, Wallet, Copy } from 'lucide-react';
import Link from 'next/link';
import type { Product, Variant } from '@/lib/types';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import type { SizeChartData } from '../SizeChartModal';
import { VariantSelector } from '../VariantSelector';

export interface BuyBoxProps {
  product: Product;
  config: StorefrontConfig;
  isVariable: boolean;
  colorAttrName: string | null;
  defaultColor?: string;
  selectedVariant: Variant | null;
  selectedAttrs: Record<string, string>;
  displayPrice: number;
  displayOriginalPrice?: number;
  displayStock?: number;
  isOutOfStock: boolean;
  qty: number;
  quantity: number;
  inCart: boolean;
  justAdded: boolean;
  sizeChartData: SizeChartData | null;
  sizeChartLoading?: boolean;
  showSizeHint: boolean;
  addedText?: string;
  wishlisted: boolean;
  heartPop?: boolean;
  copied: boolean;
  shareUrl: string;
  shareText: string;
  waHref: string;
  callHref: string;
  waNumber?: string;
  callNumber?: string;
  onSelectVariant: (v: Variant | null) => void;
  onSelectAttr: (attrName: string, value: string) => void;
  onDec: () => void;
  onInc: () => void;
  onAddToCart: () => void;
  onBuyNow: () => void;
  onWishlist: () => void;
  onCopyLink: () => void;
  onSizeGuide: () => void;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
    </svg>
  );
}

const COLOR_HEX_MAP: Record<string, string> = {
  'red': '#EF4444', 'green': '#22C55E', 'blue': '#3B82F6', 'black': '#000000',
  'white': '#FFFFFF', 'gray': '#6B7280', 'grey': '#6B7280', 'navy': '#1E3A5F',
  'pink': '#EC4899', 'purple': '#A855F7', 'yellow': '#EAB308', 'orange': '#F97316',
  'brown': '#78350F', 'teal': '#0D9488', 'maroon': '#800000', 'cream': '#FFFDD0',
  'beige': '#F5F5DC', 'khaki': '#C3B091', 'olive': '#808000', 'wine': '#722F37',
  'gold': '#FFD700', 'silver': '#C0C0C0', 'sky': '#87CEEB', 'coral': '#FF7F50',
};

function stockLine(stock?: number): string | null {
  if (stock === undefined) return 'In Stock';
  if (stock <= 0) return null;
  if (stock > 10) return `In Stock · Only ${stock} left`;
  return `Only ${stock} left!`;
}

/**
 * PDP buy box (mockup §4 order). Presentation only — every state value and
 * handler comes from the orchestrator, so cart/variant/CTA behavior is
 * unchanged (§3). Sticky positioning is applied by the parent grid.
 * Colors come from the theme (admin-configurable); only product swatch
 * data-hex, the WhatsApp icon green, and the Facebook icon blue are literal.
 */
export function BuyBox(props: BuyBoxProps) {
  const {
    product, config, isVariable, colorAttrName, defaultColor,
    selectedVariant, selectedAttrs, displayPrice, displayOriginalPrice,
    displayStock, isOutOfStock, qty, quantity, inCart, justAdded,
    sizeChartData, sizeChartLoading, showSizeHint, addedText,
    wishlisted, heartPop, copied, shareUrl, shareText, waHref, callHref,
    waNumber, callNumber,
    onSelectVariant, onSelectAttr, onDec, onInc,
    onAddToCart, onBuyNow, onWishlist, onCopyLink, onSizeGuide,
  } = props;

  const sections = product.descriptionSections;
  const line = stockLine(displayStock);
  const deliveryInfo = config.deliveryInfo;
  const showDelivery = deliveryInfo?.enabled && (deliveryInfo.rows?.length ?? 0) > 0;

  return (
    <div className="flex flex-col px-4 min-[901px]:px-0 pt-4 min-[901px]:pt-2" data-testid="buy-box">
      {/* 1. Code + wishlist */}
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-[12px] text-gray-500">
          {product.sku ? `Code: ${product.sku}` : ''}
        </span>
        <button
          onClick={onWishlist}
          aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all min-w-[44px] min-h-[44px] ${
            wishlisted ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500'
          }`}
        >
          <Heart size={20} className={`${wishlisted ? 'fill-red-500' : ''} ${heartPop ? 'animate-[heartPop_300ms_ease]' : ''}`} />
        </button>
      </div>

      {/* 2. Title + tagline */}
      <h1 className="text-[22px] min-[901px]:text-[26px] text-brand-dark font-medium leading-tight mb-1">{product.name}</h1>
      {sections?.tagline && (
        <p className="text-[15px] text-brand-blue italic leading-relaxed mb-3">{sections.tagline}</p>
      )}

      {/* 3. Price + stock one-liner + COD */}
      <div className="flex items-center gap-3 mb-1" key={`price-${displayPrice}-${selectedVariant?.id || ''}`}>
        <span className="text-[20px] font-bold text-brand-blue" style={{ animation: 'pricePop 300ms ease' }}>
          {config.currency.symbol}{(displayPrice ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        {displayOriginalPrice && displayOriginalPrice > displayPrice && (
          <>
            <span className="text-[16px] text-gray-400 line-through">{config.currency.symbol}{(displayOriginalPrice ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <div className="bg-brand-success text-white text-[12px] px-2 py-0.5 rounded-[3px] font-medium tracking-wide">
              Save {Math.round(((displayOriginalPrice - displayPrice) / displayOriginalPrice) * 100)}%
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 mb-3 min-h-[28px] flex-wrap">
        {isOutOfStock ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-[3px] text-[12px] font-medium bg-red-100 text-red-800">Out of Stock</span>
        ) : (
          <>
            {line && <span className="text-[13px] font-medium text-gray-700">{line}</span>}
          </>
        )}
      </div>

      {/* 4. Short description */}
      {product.shortDesc && (
        <p className="text-[14px] text-gray-700 leading-relaxed mb-4">{product.shortDesc}</p>
      )}

      {/* 5-6. Color + Size selectors (existing behavior, VariantSelector) */}
      {isVariable && product.variants && (
        colorAttrName && defaultColor ? (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[13px] text-gray-700 font-medium">Color:</span>
              <button
                className="w-7 h-7 rounded-full ring-2 ring-brand-blue ring-offset-1"
                style={{ backgroundColor: COLOR_HEX_MAP[defaultColor.toLowerCase().trim()] || '#CBD5E1' }}
                title={defaultColor}
                aria-label={defaultColor}
              />
              <span className="text-[13px] text-gray-500">{defaultColor}</span>
            </div>
            <VariantSelector
              variants={product.variants}
              selectedVariant={selectedVariant}
              selectedAttrs={selectedAttrs}
              onSelect={onSelectVariant}
              onSelectAttr={onSelectAttr}
              hiddenAttributes={[colorAttrName]}
              sizeGuideLabel={sizeChartData ? 'Size Guide' : undefined}
              onSizeGuideClick={sizeChartData ? onSizeGuide : undefined}
            />
          </div>
        ) : (
          <VariantSelector
            variants={product.variants}
            selectedVariant={selectedVariant}
            selectedAttrs={selectedAttrs}
            onSelect={onSelectVariant}
            onSelectAttr={onSelectAttr}
            sizeGuideLabel={sizeChartData ? 'Size Guide' : undefined}
            onSizeGuideClick={sizeChartData ? onSizeGuide : undefined}
          />
        )
      )}

      {!isVariable && (sizeChartLoading || sizeChartData) && (
        <div className="flex items-center gap-2 mb-4">
          {sizeChartLoading && <span className="text-[13px] text-gray-400 italic">Loading size chart...</span>}
          {sizeChartData && (
            <button onClick={onSizeGuide} className="text-[12px] text-gray-400 hover:text-brand-blue flex items-center gap-1 transition-colors min-h-[44px]">
              <span>📏</span>
              <span className="underline underline-offset-2">Size Guide</span>
            </button>
          )}
        </div>
      )}

      {/* 7. Inline size hint */}
      {showSizeHint && (
        <p className="text-[13px] text-brand-danger font-medium mb-2">Please select a size to continue.</p>
      )}

      {/* 8. Quantity */}
      <div className={`flex items-center gap-3 mb-4 ${isOutOfStock ? 'opacity-50' : ''}`}>
        <span className="text-[13px] text-gray-700 font-medium">Quantity:</span>
        <div className="flex items-center h-11 border border-brand-border rounded-[3px] overflow-hidden bg-white">
          <button onClick={onDec} aria-label="Decrease quantity"
            className={`w-11 h-full flex items-center justify-center text-gray-500 transition-colors ${isOutOfStock ? 'cursor-not-allowed' : 'hover:bg-gray-50'}`} disabled={isOutOfStock}><Minus size={14} /></button>
          <div className="w-[44px] border-x border-brand-border h-full flex items-center justify-center text-[14px] font-medium select-none">{inCart ? quantity : qty}</div>
          <button onClick={onInc} aria-label="Increase quantity"
            className={`w-11 h-full flex items-center justify-center text-gray-500 transition-colors ${isOutOfStock ? 'cursor-not-allowed' : 'hover:bg-gray-50'}`} disabled={isOutOfStock}><Plus size={14} /></button>
        </div>
      </div>

      {/* 9. CTA column: ORDER NOW → ADD TO CART */}
      <div className="flex flex-col gap-2 mb-4 w-full" data-cta>
        {isOutOfStock ? (
          <button disabled
            className="w-full h-10 min-[901px]:h-11 rounded-[3px] bg-gray-200 text-gray-500 font-bold flex items-center justify-center gap-2 text-[14px] min-[901px]:text-[15px] tracking-wide cursor-not-allowed">
            <X size={16} /> OUT OF STOCK
          </button>
        ) : (
          <>
            <button onClick={onBuyNow}
              className="w-full h-10 min-[901px]:h-11 rounded-[3px] bg-brand-blue hover:bg-brand-blue-dark text-white font-bold flex items-center justify-center gap-2 transition-colors text-[14px] min-[901px]:text-[15px] tracking-wide animate-[bump_1.5s_ease-in-out_infinite]">
              ORDER NOW
            </button>
            <button onClick={onAddToCart}
              className={`w-full h-10 min-[901px]:h-11 rounded-[3px] font-medium flex items-center justify-center gap-2 transition-all text-[13px] min-[901px]:text-[14px] ${
                justAdded
                  ? 'bg-brand-success text-white'
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
          </>
        )}
      </div>

      {/* 10. added text / buy-now pending */}
      {addedText ? (
        <p className="text-[13px] text-brand-success font-medium mb-2">{addedText}</p>
      ) : null}

      {/* 11. WhatsApp + Call — subtle secondary row on all devices */}
      <div className="flex gap-2 mb-4">
        <a href={waHref} target="_blank" rel="noreferrer"
          className={`flex-1 h-10 rounded-[3px] bg-white border border-brand-border text-brand-dark text-[13px] font-semibold flex items-center justify-center gap-2 hover:border-brand-blue transition-all active:scale-[0.98] ${!waNumber ? 'opacity-50 pointer-events-none' : ''}`}>
          <span className="text-[#25D366] flex items-center"><WhatsAppIcon /></span>
          <span>ORDER VIA WHATSAPP</span>
        </a>
        <a href={callHref}
          className={`flex-1 h-10 rounded-[3px] bg-white border border-brand-border text-brand-dark text-[13px] font-semibold flex items-center justify-center gap-2 hover:border-brand-blue transition-all active:scale-[0.98] ${!callNumber ? 'opacity-30 pointer-events-none' : ''}`}>
          <span>CALL</span>
        </a>
      </div>

      {/* 12. Delivery info card */}
      {showDelivery && (
        <div className="border border-brand-border rounded-[3px] mb-4 overflow-hidden">
          {deliveryInfo.title ? (
            <p className="m-0 px-[18px] py-3 text-[15px] font-medium border-b border-brand-border bg-gray-50">{deliveryInfo.title}</p>
          ) : null}
          <dl className="m-0 px-[18px]">
            {deliveryInfo.rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-[11px] border-t border-brand-border first:border-t-0 text-[14px] items-center">
                <dt className="text-gray-500 text-[13px]">{row.label}</dt>
                <dd className="m-0 text-brand-dark font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* 13. Trust bar */}
      <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1 mb-4">
        {[
          { icon: <Truck size={16} />, label: `Free Delivery${config.delivery.freeDeliveryMin > 0 ? ` (over ৳${config.delivery.freeDeliveryMin.toLocaleString()})` : ''}`, key: 'delivery' },
          { icon: <Wallet size={16} />, label: 'Cash on Delivery', key: 'cod' },
          { icon: <RefreshCw size={16} />, label: 'Easy Returns', key: 'returns' },
          { icon: <ShieldCheck size={16} />, label: 'Secure Payment', key: 'payment' },
        ].map((item) => (
          <div key={item.key} className="flex-shrink-0 flex flex-col items-center gap-1.5 bg-gray-50 rounded-[3px] px-4 py-3 min-w-[100px]">
            <div className="text-gray-500">{item.icon}</div>
            <span className="text-[11px] text-gray-600 text-center leading-tight font-medium">{item.label}</span>
          </div>
        ))}
      </div>

      {/* 14. Share */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[13px] text-gray-500 font-medium">Share:</span>
        <button onClick={onCopyLink} aria-label="Copy product link"
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-all">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`}
          target="_blank" rel="noreferrer" aria-label="Share on Facebook"
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:text-[#1877f2] hover:border-[#1877f2] transition-all">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
        </a>
        <a href={`https://wa.me/?text=${shareText}%20${shareUrl}`}
          target="_blank" rel="noreferrer" aria-label="Share on WhatsApp"
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:text-[#25D366] hover:border-[#25D366] transition-all">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        </a>
      </div>

      {/* 15. Styling tip */}
      {sections?.stylingTip && (
        <div className="mb-4">
          <p className="text-[13px] text-gray-400 italic flex items-start gap-2">
            <span>💡</span>
            <span>{sections.stylingTip}</span>
          </p>
        </div>
      )}
    </div>
  );
}
