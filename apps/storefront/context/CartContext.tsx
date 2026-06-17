"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { CartItem } from "@/lib/types";

export interface VariantAttribute {
  name: string;
  value: string;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: CartItem) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  cartCount: number;
  cartTotal: number;
  isCartOpen: boolean;
  setIsCartOpen: (isOpen: boolean) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);
const STORAGE_KEY = 'ecomate_cart';

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

export function getItemKey(item: { id: string; variantId?: string; comboSelections?: Record<string, string> }) {
  if (item.comboSelections && Object.keys(item.comboSelections).length > 0) {
    return `${item.id}::sel::${stableStringify(item.comboSelections)}`;
  }
  return item.variantId ? `${item.id}::${item.variantId}` : item.id;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const userDismissedRef = useRef(false);

  const handleSetIsCartOpen = useCallback((open: boolean) => {
    if (!open) userDismissedRef.current = true;
    else userDismissedRef.current = false;
    setIsCartOpen(open);
  }, []);

  useEffect(() => {
    setItems(loadCart());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveCart(items);
  }, [items, loaded]);

  const addToCart = useCallback((product: CartItem) => {
    const qtyToAdd = product.quantity || 1;
    setItems((prev) => {
      const key = getItemKey(product);
      const existing = prev.find((item) => getItemKey(item) === key);
      return existing
        ? prev.map((item) => {
            if (getItemKey(item) === key) {
              const newQty = item.quantity + qtyToAdd;
              const cappedQty = item.stock !== undefined ? Math.min(newQty, item.stock) : newQty;
              return { ...item, quantity: cappedQty };
            }
            return item;
          })
        : [...prev, { ...product, quantity: product.stock !== undefined ? Math.min(qtyToAdd, product.stock) : qtyToAdd }];
    });
    if (!userDismissedRef.current) setIsCartOpen(true);
  }, []);

  const removeFromCart = (productKey: string) => {
    setItems((prev) => prev.filter((item) => getItemKey(item) !== productKey));
  };

  const updateQuantity = (productKey: string, quantity: number) => {
    if (quantity <= 0) { removeFromCart(productKey); return; }
    setItems((prev) =>
      prev.map((item) => {
        if (getItemKey(item) === productKey) {
          const cappedQty = item.stock !== undefined ? Math.min(quantity, item.stock) : quantity;
          return { ...item, quantity: cappedQty };
        }
        return item;
      })
    );
  };

  const clearCart = useCallback(() => setItems([]), []);

  const cartCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, cartCount, cartTotal, isCartOpen, setIsCartOpen: handleSetIsCartOpen, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) throw new Error('useCart must be used within a CartProvider');
  return context;
}
