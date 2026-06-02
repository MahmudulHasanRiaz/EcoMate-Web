"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface CartItem {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  quantity: number;
  category?: string;
  slug?: string;
  stock?: number;
  isCombo?: boolean;
  comboId?: string;
  comboItems?: { productId: string; productName: string; quantity: number; price?: number }[];
  variantId?: string;
  variantLabel?: string;
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

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    setItems(loadCart());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveCart(items);
  }, [items, loaded]);

  function itemKey(item: { id: string; variantId?: string }) {
    return item.variantId ? `${item.id}::${item.variantId}` : item.id;
  }

  const addToCart = (product: CartItem) => {
    setItems((prev) => {
      const key = itemKey(product);
      const existing = prev.find((item) => itemKey(item) === key);
      if (existing) {
        return prev.map((item) =>
          itemKey(item) === key ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (productKey: string) => {
    setItems((prev) => prev.filter((item) => itemKey(item) !== productKey));
  };

  const updateQuantity = (productKey: string, quantity: number) => {
    if (quantity <= 0) { removeFromCart(productKey); return; }
    setItems((prev) =>
      prev.map((item) => itemKey(item) === productKey ? { ...item, quantity } : item)
    );
  };

  const clearCart = () => setItems([]);

  const cartCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, cartCount, cartTotal, isCartOpen, setIsCartOpen, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) throw new Error('useCart must be used within a CartProvider');
  return context;
}
