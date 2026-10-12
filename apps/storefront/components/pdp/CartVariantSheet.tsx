"use client";

import { Minus, Plus, ShoppingBag, Check } from 'lucide-react';
import Link from 'next/link';
import type { Product, Variant } from '@/lib/types';
import type { SizeChartData } from '../SizeChartModal';
import { VariantSelector } from '../VariantSelector';
import { SheetShell } from './SheetShell';

export interface CartVariantSheetProps {
  product: Product;
  displayPrice: number;
  selectedVariant: Variant | null;
  selectedAttrs: Record<string, string>;
  qty: number;
  quantity: number;
  inCart: boolean;
  justAdded: boolean;
  hintText: string | null;
  isVariable: boolean;
  colorAttrName: string | null;
  defaultColor?: string;
  sizeChartData: SizeChartData | null;
  // Feature-flag gate for the Size Guide trigger (chart loads lazily).
  sizeGuideAvailable: boolean;
  onSelectVariant: (v: Variant | null) => void;
  onSelectAttr: (attrName: string, value: string) => void;
  onDec: () => void;
  onInc: () => void;
  onAddToCart: () => void;
  onBuyNow: () => void;
  onSizeGuide: () => void;
  onClose: () => void;
}

/**
 * Variant/cart sheet (mockup §5): opened from the sticky bar so the shopper
 * never scrolls up. Selectors + qty mirror the buy box; validation stays
 * inline; post-add confirmation offers CONTINUE SHOPPING / VIEW CART.
 * Rendered inside SheetShell by the orchestrator (which owns open state).
 */
export function CartVariantSheet(props: CartVariantSheetProps) {
  const {
    product, displayPrice, selectedVariant, selectedAttrs,
    qty, quantity, inCart, justAdded, hintText, isVariable,
    colorAttrName, defaultColor, sizeChartData, sizeGuideAvailable,
    onSelectVariant, onSelectAttr, onDec, onInc,
    onAddToCart, onBuyNow, onSizeGuide, onClose,
  } = props;

  return (
    <SheetShell title={product.name} onClose={onClose}>
      <div className="flex items-center gap-3 mb-4">
        {product.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt="" className="w-14 h-[70px] object-cover rounded-[3px]" />
        )}
        <div className="min-w-0">
          <p className="m-0 text-[14px] font-medium text-brand-dark truncate">{product.name}</p>
          <p className="m-0 text-[16px] font-bold text-brand-blue">৳{displayPrice.toLocaleString()}</p>
        </div>
      </div>

      {justAdded ? (
        <div className="text-center py-2">
          <span className="mx-auto mb-2 flex w-12 h-12 items-center justify-center rounded-full bg-green-50 text-brand-success">
            <Check size={24} />
          </span>
          <p className="m-0 text-[15px] font-semibold text-brand-success">Added to cart</p>
          <div className="flex flex-col gap-2 mt-4">
            <button
              onClick={onClose}
              className="w-full h-10 rounded-[3px] border border-brand-border text-brand-dark text-[13px] font-semibold tracking-wide"
            >
              CONTINUE SHOPPING
            </button>
            <Link
              href="/cart"
              className="w-full h-10 rounded-[3px] bg-brand-blue text-white text-[13px] font-semibold tracking-wide flex items-center justify-center"
            >
              VIEW CART
            </Link>
          </div>
        </div>
      ) : (
        <>
          {isVariable && product.variants && (
            <VariantSelector
              variants={product.variants}
              selectedVariant={selectedVariant}
              selectedAttrs={selectedAttrs}
              onSelect={onSelectVariant}
              onSelectAttr={onSelectAttr}
              hiddenAttributes={colorAttrName && defaultColor ? [colorAttrName] : undefined}
              sizeGuideLabel={sizeGuideAvailable ? 'Size Guide' : undefined}
              onSizeGuideClick={sizeGuideAvailable ? onSizeGuide : undefined}
            />
          )}

          {hintText && (
            <p className="text-[13px] text-brand-danger font-medium mt-2">{hintText}</p>
          )}

          <div className="flex items-center gap-3 my-4">
            <span className="text-[13px] text-gray-700 font-medium">Quantity:</span>
            <div className="flex items-center h-11 border border-brand-border rounded-[3px] overflow-hidden bg-white">
              <button onClick={onDec} aria-label="Decrease quantity" className="w-11 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"><Minus size={14} /></button>
              <div className="w-[44px] border-x border-brand-border h-full flex items-center justify-center text-[14px] font-medium select-none">{inCart ? quantity : qty}</div>
              <button onClick={onInc} aria-label="Increase quantity" className="w-11 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"><Plus size={14} /></button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {/* Same 3-state contract as the buy box: in-cart shows an
                explicit REMOVE label, so ADD never silently removes. */}
            <button
              onClick={onAddToCart}
              className="w-full h-10 rounded-[3px] border-2 border-brand-blue text-brand-blue bg-white hover:bg-brand-blue/5 font-medium flex items-center justify-center gap-2 text-[13px]"
            >
              {inCart ? (<><ShoppingBag size={16} /> REMOVE FROM CART</>) : (<><ShoppingBag size={16} /> ADD TO CART</>)}
            </button>
            <button
              onClick={onBuyNow}
              className="w-full h-10 rounded-[3px] bg-brand-blue hover:bg-brand-blue-dark text-white font-bold flex items-center justify-center gap-2 text-[14px] tracking-wide"
            >
              ORDER NOW
            </button>
          </div>
        </>
      )}
    </SheetShell>
  );
}
