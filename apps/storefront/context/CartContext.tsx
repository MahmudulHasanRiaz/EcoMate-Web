"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { CartItem } from "@/lib/types";
import { cartLineTotal, selectionKey } from "@/lib/customization";

export interface VariantAttribute {
  name: string;
  value: string;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: CartItem, skipOpen?: boolean) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  cartCount: number;
  cartTotal: number;
  isCartOpen: boolean;
  setIsCartOpen: (isOpen: boolean) => void;
  clearCart: () => void;
  /** Buy Now single-item checkout: exactly one unit of one product/variant,
   * isolated from the cart. The shared cart is never touched by Buy Now. */
  buyNowItem: CartItem | null;
  startBuyNow: (product: CartItem) => void;
  updateBuyNowQuantity: (quantity: number) => void;
  removeBuyNow: () => void;
  clearBuyNow: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);
const STORAGE_KEY = 'ecomate_cart';
const BUYNOW_STORAGE_KEY = 'ecomate_buynow';

function loadBuyNow(): CartItem | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(BUYNOW_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem) : null;
  } catch { return null; }
}

function saveBuyNow(item: CartItem | null) {
  if (typeof window === 'undefined') return;
  try {
    if (item) sessionStorage.setItem(BUYNOW_STORAGE_KEY, JSON.stringify(item));
    else sessionStorage.removeItem(BUYNOW_STORAGE_KEY);
  } catch { /* storage unavailable — in-memory state still works */ }
}

function capBuyNowQty(quantity: number, stock: CartItem['stock']): number {
  if (stock != null) return Math.min(Math.max(quantity, 0), stock);
  return Math.max(quantity, 0);
}

function loadCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCart(items: CartItem[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function stableStringify(obj: Record<string, string>): string {
  return JSON.stringify(Object.keys(obj).sort().reduce((acc, k) => {
    acc[k] = obj[k];
    return acc;
  }, {} as Record<string, string>));
}

export function getItemKey(item: { id: string; variantId?: string; comboSelections?: Record<string, string>; customization?: CartItem['customization'] }) {
  // A customized line is its own cart line: the same product with a
  // different engraving text or gift option must never merge.
  if (item.customization?.selection) {
    const base = item.variantId ? `${item.id}::${item.variantId}` : item.id;
    return `${base}::cust::${selectionKey(item.customization.selection)}`;
  }
  if (item.comboSelections && Object.keys(item.comboSelections).length > 0) {
    return `${item.id}::sel::${stableStringify(item.comboSelections)}`;
  }
  return item.variantId ? `${item.id}::${item.variantId}` : item.id;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [buyNowItem, setBuyNowItem] = useState<CartItem | null>(null);
  const [buyNowLoaded, setBuyNowLoaded] = useState(false);
  const userDismissedRef = useRef(false);

  // Load cart from localStorage after hydration to avoid SSR mismatch
  useEffect(() => {
    setItems(loadCart());
    setLoaded(true);
    setBuyNowItem(loadBuyNow());
    setBuyNowLoaded(true);
  }, []);

  const handleSetIsCartOpen = useCallback((open: boolean) => {
    if (!open) userDismissedRef.current = true;
    else userDismissedRef.current = false;
    setIsCartOpen(open);
  }, []);

  useEffect(() => {
    if (loaded) saveCart(items);
  }, [items, loaded]);

  const addToCart = useCallback((product: CartItem, skipOpen?: boolean) => {
    if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') return;
    if (product.stock != null && product.stock <= 0) return;
    const qtyToAdd = product.quantity || 1;
    setItems((prev) => {
      const key = getItemKey(product);
      const existing = prev.find((item) => getItemKey(item) === key);
      return existing
        ? prev.map((item) => {
            if (getItemKey(item) === key) {
              const newQty = item.quantity + qtyToAdd;
              const cappedQty = item.stock != null ? Math.min(newQty, item.stock) : newQty;
              return { ...item, quantity: cappedQty };
            }
            return item;
          })
        : [...prev, { ...product, quantity: product.stock != null ? Math.min(qtyToAdd, product.stock) : qtyToAdd }];
    });
    if (!skipOpen && !userDismissedRef.current) setIsCartOpen(true);
  }, []);

  const removeFromCart = (productKey: string) => {
    setItems((prev) => prev.filter((item) => getItemKey(item) !== productKey));
  };

  const updateQuantity = (productKey: string, quantity: number) => {
    if (quantity <= 0) { removeFromCart(productKey); return; }
    setItems((prev) =>
      prev.map((item) => {
        if (getItemKey(item) === productKey) {
          if (item.availabilityMode === 'ALWAYS_OUT_OF_STOCK') return item;
          if (item.stock != null && item.stock <= 0) return item;
          const cappedQty = item.stock != null ? Math.min(quantity, item.stock) : quantity;
          return { ...item, quantity: cappedQty };
        }
        return item;
      })
    );
  };

  const clearCart = useCallback(() => setItems([]), []);

  // ── Buy Now: isolated single-item checkout ──────────────────────────
  // The pending Buy Now item lives OUTSIDE the cart so repeat Buy Now
  // clicks can never merge quantities, and other cart items never leak
  // into a Buy Now checkout. sessionStorage (per-tab) carries the intent
  // across the full-page navigation to /checkout.
  useEffect(() => {
    if (buyNowLoaded) saveBuyNow(buyNowItem);
  }, [buyNowItem, buyNowLoaded]);

  const startBuyNow = useCallback((product: CartItem) => {
    if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') return;
    if (product.stock != null && product.stock <= 0) return;
    setBuyNowItem({ ...product, quantity: product.stock != null ? Math.min(1, product.stock) : 1 });
  }, []);

  const updateBuyNowQuantity = useCallback((quantity: number) => {
    setBuyNowItem((prev) => {
      if (!prev) return prev;
      if (prev.availabilityMode === 'ALWAYS_OUT_OF_STOCK') return prev;
      if (prev.stock != null && prev.stock <= 0) return prev;
      if (quantity <= 0) return null;
      return { ...prev, quantity: capBuyNowQty(quantity, prev.stock) };
    });
  }, []);

  const removeBuyNow = useCallback(() => setBuyNowItem(null), []);
  const clearBuyNow = useCallback(() => setBuyNowItem(null), []);

  const cartCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = items.reduce((sum, item) => sum + cartLineTotal(item), 0);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, cartCount, cartTotal, isCartOpen, setIsCartOpen: handleSetIsCartOpen, clearCart, buyNowItem, startBuyNow, updateBuyNowQuantity, removeBuyNow, clearBuyNow }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) throw new Error('useCart must be used within a CartProvider');
  return context;
}
