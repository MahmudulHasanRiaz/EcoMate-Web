import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MediaSource } from '../lib/media';

interface CartItem {
  productId?: string;
  variantId?: string;
  name: string;
  sku?: string;
  price: number;
  quantity: number;
  image?: MediaSource;
  imageVersion?: string;
  stockCheckStatus?: 'ok' | 'low' | 'out';
  warehouseId?: string;
}

interface CartState {
  items: CartItem[];
  orderDiscount: number;
  orderDiscountType: 'flat' | 'percentage';
  customerId: string | null;
  guestName: string;
  guestPhone: string;
  salesChannel: string;
  deliveryMethod: string;
  notes: string;
  addItem: (item: CartItem) => void;
  updateQuantity: (index: number, qty: number) => void;
  removeItem: (index: number) => void;
  setOrderDiscount: (discount: number, type: 'flat' | 'percentage') => void;
  setCustomer: (customerId: string | null, name: string, phone: string) => void;
  setSalesChannel: (channel: string) => void;
  setDeliveryMethod: (method: string) => void;
  setNotes: (notes: string) => void;
  clearCart: () => void;
  subtotal: () => number;
  totalDiscount: () => number;
  total: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      orderDiscount: 0,
      orderDiscountType: 'flat',
      customerId: null,
      guestName: '',
      guestPhone: '',
      salesChannel: 'POS',
      deliveryMethod: 'Counter Sale',
      notes: '',

      addItem: (item) =>
        set((state) => {
          const existing = state.items.findIndex(
            (i) => i.productId === item.productId && i.variantId === item.variantId,
          );
          if (existing >= 0) {
            const items = [...state.items];
            // Refresh mutable product/media fields when an existing cart line
            // is added again after a restore or media reprocess.
            items[existing] = {
              ...items[existing],
              ...item,
              quantity: items[existing].quantity + item.quantity,
            };
            return { items };
          }
          return { items: [...state.items, item] };
        }),

      updateQuantity: (index, qty) =>
        set((state) => {
          if (qty <= 0) return { items: state.items.filter((_, i) => i !== index) };
          const items = [...state.items];
          items[index] = { ...items[index], quantity: qty };
          return { items };
        }),

      removeItem: (index) =>
        set((state) => ({ items: state.items.filter((_, i) => i !== index) })),

      setOrderDiscount: (discount, type) => set({ orderDiscount: discount, orderDiscountType: type }),
      setCustomer: (customerId, name, phone) => set({ customerId, guestName: name, guestPhone: phone }),
      setSalesChannel: (channel) => set({ salesChannel: channel }),
      setDeliveryMethod: (method) => set({ deliveryMethod: method }),
      setNotes: (notes) => set({ notes }),
      clearCart: () => set({
        items: [], orderDiscount: 0, orderDiscountType: 'flat',
        customerId: null, guestName: '', guestPhone: '',
        salesChannel: 'POS', deliveryMethod: 'Counter Sale', notes: '',
      }),

      subtotal: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),

      totalDiscount: () => {
        const state = get();
        const subtotal = state.items.reduce((s, i) => s + i.price * i.quantity, 0);
        // Order-level discount only. (Per-line discount fields were removed:
        // no UI ever set them, and the backend prices + validates the same
        // order-level rule — a second discount path could only disagree.)
        return state.orderDiscount
          ? (state.orderDiscountType === 'percentage' ? (subtotal * state.orderDiscount) / 100 : state.orderDiscount)
          : 0;
      },

      total: () => {
        const state = get();
        return state.subtotal() - state.totalDiscount();
      },
    }),
    {
      name: 'pos-cart',
    },
  ),
);
