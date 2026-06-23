"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface OrderLineItem {
  productId: string;
  productName: string;
  productImage?: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
  price: number;
  maxStock: number;
}

export interface DeliveryZone {
  label: string;
  charge: number;
}

interface OrderContextValue {
  items: OrderLineItem[];
  deliveryZone: DeliveryZone;
  setDeliveryZone: (zone: DeliveryZone) => void;
  subtotal: number;
  deliveryCharge: number;
  total: number;
  updateItem: (productId: string, updates: Partial<OrderLineItem>) => void;
  removeItem: (productId: string) => void;
  reset: () => void;
}

const DEFAULT_DELIVERY: DeliveryZone = { label: "Inside Dhaka", charge: 60 };

const OrderContext = createContext<OrderContextValue | null>(null);

export function LandingOrderProvider({ children, initialItems = [] }: { children: ReactNode; initialItems?: OrderLineItem[] }) {
  const [items, setItems] = useState<OrderLineItem[]>(initialItems);
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone>(DEFAULT_DELIVERY);

  const updateItem = useCallback((productId: string, updates: Partial<OrderLineItem>) => {
    setItems(prev => prev.map(item =>
      item.productId === productId ? { ...item, ...updates } : item
    ));
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems(prev => prev.filter(i => i.productId !== productId));
  }, []);

  const reset = useCallback(() => {
    setItems([]);
    setDeliveryZone(DEFAULT_DELIVERY);
  }, []);

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const deliveryCharge = deliveryZone.charge;
  const total = subtotal + deliveryCharge;

  return (
    <OrderContext.Provider value={{ items, deliveryZone, setDeliveryZone, subtotal, deliveryCharge, total, updateItem, removeItem, reset }}>
      {children}
    </OrderContext.Provider>
  );
}

export function useOrder() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error("useOrder must be used within LandingOrderProvider");
  return ctx;
}
