"use client";

import { ShoppingBag, X } from 'lucide-react';

interface Props {
  isOutOfStock: boolean;
  onOpenSheet: () => void;
}

/**
 * Sticky mobile bottom bar (mockup mbar): opens the variant sheet in place
 * so the shopper never scrolls up to the buy box. Desktop buy box is
 * sticky on its own, so this renders on mobile only.
 */
export function StickyBar({ isOutOfStock, onOpenSheet }: Props) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] pb-safe md:hidden">
      <div className="flex items-stretch gap-1.5 px-3 py-2 max-w-screen-xl mx-auto">
        {isOutOfStock ? (
          <div className="flex-1 rounded-lg bg-gray-200 text-gray-500 text-[14px] font-bold flex items-center justify-center gap-1.5 cursor-not-allowed min-h-[44px]">
            <X size={16} strokeWidth={2.5} />
            <span>Out of Stock</span>
          </div>
        ) : (
          <>
            <button
              onClick={onOpenSheet}
              className="flex-1 rounded-lg border-2 border-brand-blue text-brand-blue text-[14px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] min-h-[44px]"
            >
              <ShoppingBag size={16} strokeWidth={2.5} />
              <span>ADD TO CART</span>
            </button>
            <button
              onClick={onOpenSheet}
              className="flex-[1.2] rounded-lg bg-brand-blue text-white text-[14px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] hover:bg-brand-blue-dark min-h-[44px]"
            >
              <ShoppingBag size={16} strokeWidth={2.5} />
              <span>ORDER NOW</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
