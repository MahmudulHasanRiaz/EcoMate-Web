"use client";

import { useState } from "react";
import { ShoppingBag, Minus, Plus, X, Trash2, ArrowRight, Gift, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCart, getItemKey, type VariantAttribute } from "@/context/CartContext";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

function fmtAttr(attrs: VariantAttribute[] | undefined, fallback?: string): string | null {
  if (attrs && attrs.length > 0) {
    return attrs.map((a) => `${a.name}: ${a.value}`).join(", ");
  }
  if (fallback?.trim()) return fallback;
  return null;
}

export default function CartPage() {
  const { items, updateQuantity, removeFromCart, cartTotal, cartCount, clearCart } = useCart();
  const { config } = useStorefrontConfig();
  const s = config.currency.symbol;
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [imgErrors, setImgErrors] = useState<{ [key: string]: boolean }>({});

  const deliveryThreshold = config.delivery?.freeDeliveryMin || 0;
  const deliveryProgress = deliveryThreshold > 0 ? Math.min(100, (cartTotal / deliveryThreshold) * 100) : 100;
  const deliveryRemaining = deliveryThreshold > 0 ? Math.max(0, deliveryThreshold - cartTotal) : 0;

  return (
    <div className="max-w-screen-xl mx-auto px-3 md:px-4 py-4 md:py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-gray-500 mb-4">
        <Link href="/" className="hover:text-gray-800 transition-colors">Home</Link>
        <ChevronRight size={14} />
        <span className="text-gray-800 font-medium">Cart</span>
      </div>

      <h1 className="text-[22px] md:text-[28px] font-bold text-gray-900 mb-6">Shopping Cart</h1>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-16 md:py-24 space-y-5">
          <div className="w-28 h-28 bg-brand-blue/10 rounded-full flex items-center justify-center text-brand-blue">
            <ShoppingBag size={56} strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-gray-900 font-bold text-xl mb-1">Your cart is empty</p>
            <p className="text-gray-500 text-sm">Looks like you haven&apos;t added anything yet.</p>
          </div>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 bg-brand-blue text-white font-semibold px-6 py-3 rounded-xl hover:bg-brand-blue-dark transition-colors text-[14px]"
          >
            Continue Shopping <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
          {/* Cart Items */}
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[14px] text-gray-500">{cartCount} item{cartCount !== 1 ? "s" : ""}</p>
              <button
                onClick={clearCart}
                className="text-[13px] text-red-500 hover:text-red-600 flex items-center gap-1.5 transition-colors"
              >
                <Trash2 size={14} /> Clear All
              </button>
            </div>

            {items.map((item) => {
              const key = getItemKey(item);
              return (
                <div
                  key={key}
                  className="bg-white rounded-xl p-3 md:p-4 border border-gray-100 shadow-sm flex gap-3 md:gap-4 relative"
                >
                  <div className="w-[72px] h-[72px] md:w-[88px] md:h-[88px] bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-center p-1 flex-shrink-0">
                    <Image
                      src={imgErrors[key] ? PLACEHOLDER_IMAGE : (item.image || PLACEHOLDER_IMAGE)}
                      alt={item.name}
                      width={88} height={88}
                      className="w-full h-full object-contain"
                      onError={() => setImgErrors((prev) => ({ ...prev, [key]: true }))}
                    />
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={item.slug ? `/products/${item.slug}` : "#"}
                          className="text-[14px] md:text-[15px] font-medium text-gray-800 leading-tight hover:text-brand-blue transition-colors line-clamp-2"
                        >
                          {item.name}
                        </Link>
                        {(() => {
                          const attrText = fmtAttr(item.variantAttributes, item.variantLabel);
                          if (attrText) {
                            return (
                              <span className="block text-[12px] text-gray-500 mt-0.5">{attrText}</span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      <button
                        onClick={() => removeFromCart(key)}
                        className="text-gray-300 hover:text-red-500 transition-colors p-0.5 flex-shrink-0"
                        aria-label="Remove item"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between mt-2 md:mt-auto pt-2">
                      <div className="flex items-center h-[32px] border border-gray-200 rounded-lg overflow-hidden bg-white">
                        <button
                          onClick={() => updateQuantity(key, item.quantity - 1)}
                          className="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <div className="w-[36px] h-full flex items-center justify-center text-[13px] font-medium border-x border-gray-200 select-none">
                          {item.quantity}
                        </div>
                        <button
                          onClick={() => updateQuantity(key, item.quantity + 1)}
                          className="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      <div className="text-right">
                        <span className="text-[15px] md:text-[16px] font-bold text-gray-900">
                          {s}{fmt(item.price * item.quantity)}
                        </span>
                        {item.originalPrice && item.originalPrice > item.price && (
                          <span className="block text-[11px] text-gray-400 line-through">
                            {s}{fmt(item.originalPrice * item.quantity)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-[13px] text-brand-blue hover:text-brand-blue-dark font-medium transition-colors mt-2"
            >
              <ChevronRight size={14} className="-ml-1" /> Continue Shopping
            </Link>
          </div>

          {/* Order Summary */}
          <div className="w-full lg:w-[360px] flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 md:p-6 sticky top-4 space-y-4">
              <h3 className="text-[16px] font-bold text-gray-900">Order Summary</h3>

              {deliveryThreshold > 0 && (
                <div className="bg-brand-blue/5 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 text-[12px] text-gray-600">
                    <Gift size={14} className="text-brand-blue shrink-0" />
                    {deliveryRemaining > 0 ? (
                      <span>Add <strong className="text-brand-blue">{s}{fmt(deliveryRemaining)}</strong> more for free delivery!</span>
                    ) : (
                      <span className="text-green-600 font-medium">Free delivery unlocked!</span>
                    )}
                  </div>
                  <div className="w-full h-[4px] bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-blue rounded-full transition-all duration-300"
                      style={{ width: `${deliveryProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 text-[14px]">
                <div className="flex items-center justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-medium text-gray-800">{s}{fmt(cartTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-gray-600">
                  <span>Delivery</span>
                  <span className="font-medium text-green-600">
                    {deliveryRemaining > 0 ? "To be calculated" : "FREE"}
                  </span>
                </div>
              </div>

              <div className="border-t pt-3 flex items-center justify-between">
                <span className="text-[16px] font-bold text-gray-900">Total</span>
                <span className="text-[20px] font-bold text-brand-blue">{s}{fmt(cartTotal)}</span>
              </div>

              <Link
                href="/checkout"
                className="w-full h-[48px] rounded-[4px] bg-brand-blue hover:bg-brand-blue-dark text-white font-bold flex items-center justify-center gap-2 transition-colors text-[14px]"
              >
                Proceed to Checkout <ArrowRight size={16} />
              </Link>

              <Link
                href="/products"
                className="w-full h-[44px] rounded-[4px] border-2 border-brand-blue/20 text-brand-blue font-semibold flex items-center justify-center gap-2 hover:bg-brand-blue/5 transition-colors text-[13px]"
              >
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
