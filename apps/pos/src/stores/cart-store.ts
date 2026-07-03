import { create } from 'zustand';

interface CartItem {
  productId?: string;
  variantId?: string;
  name: string;
  sku?: string;
  price: number;
  quantity: number;
  discount?: number;
  discountType?: 'flat' | 'percentage';
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

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  orderDiscount: 0,
  orderDiscountType: 'flat',
  customerId: null,
  guestName: '',
  guestPhone: '',
  salesChannel: 'WALK_IN',
  deliveryMethod: 'Counter Sale',
  notes: '',

  addItem: (item) =>
    set((state) => {
      const existing = state.items.findIndex(
        (i) => i.productId === item.productId && i.variantId === item.variantId,
      );
      if (existing >= 0) {
        const items = [...state.items];
        items[existing] = { ...items[existing], quantity: items[existing].quantity + item.quantity };
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
    salesChannel: 'WALK_IN', deliveryMethod: 'Counter Sale', notes: '',
  }),

  subtotal: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),

  totalDiscount: () => {
    const state = get();
    const subtotal = state.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const itemDiscount = state.items.reduce((s, i) => {
      if (!i.discount) return s;
      const lineTotal = i.price * i.quantity;
      return s + (i.discountType === 'percentage' ? (lineTotal * i.discount) / 100 : i.discount);
    }, 0);
    const afterItems = subtotal - itemDiscount;
    const orderD = state.orderDiscount
      ? (state.orderDiscountType === 'percentage' ? (afterItems * state.orderDiscount) / 100 : state.orderDiscount)
      : 0;
    return itemDiscount + orderD;
  },

  total: () => {
    const state = get();
    return state.subtotal() - state.totalDiscount();
  },
}));
