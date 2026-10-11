"use client";

import { ShoppingCart, Zap, X } from 'lucide-react';

interface Props {
  isOutOfStock: boolean;
  /** visible only when the buy-box CTAs are scrolled out of view */
  visible: boolean;
  onOpenSheet: () => void;
}

/**
 * Sticky mobile bottom bar (≤900px, mockup mbar): appears only once the
 * buy-box CTAs scroll out of view, and opens the variant sheet in place so
 * the shopper never scrolls up. The desktop buy box is sticky on its own,
 * so this renders on small screens only. Distinct icons per action so the
 * two buttons never read as duplicates.
 */
export function StickyBar({ isOutOfStock, visible, onOpenSheet }: Props) {
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] pb-safe hidden max-[900px]:block transition-transform duration-300 ${visible ? 'translate-y-0' : 'translate-y-full pointer-events-none'}`}
      data-testid="sticky-bar"
      aria-hidden={!visible}
    >
      <div className="flex items-stretch gap-1.5 px-3 py-2 max-w-screen-xl mx-auto">
        {isOutOfStock ? (
          <div className="flex-1 rounded-[3px] bg-gray-200 text-gray-500 text-[14px] font-bold flex items-center justify-center gap-1.5 cursor-not-allowed min-h-10">
            <X size={16} strokeWidth={2.5} />
            <span>Out of Stock</span>
          </div>
        ) : (
          <>
            <button
              onClick={onOpenSheet}
              className="flex-1 rounded-[3px] border-2 border-brand-blue text-brand-blue text-[14px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] min-h-10"
            >
              <ShoppingCart size={16} strokeWidth={2.5} />
              <span>ADD TO CART</span>
            </button>
            <button
              onClick={onOpenSheet}
              className="flex-[1.2] rounded-[3px] bg-brand-blue text-white text-[14px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] hover:bg-brand-blue-dark min-h-10"
            >
              <Zap size={16} strokeWidth={2.5} />
              <span>ORDER NOW</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
