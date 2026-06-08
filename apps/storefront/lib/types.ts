export interface VariantAttribute {
  id: string;
  value: string;
  attribute: {
    id: string;
    name: string;
  };
}

export interface Variant {
  id: string;
  sku: string;
  price: number;
  stock: number;
  image?: string;
  isActive: boolean;
  attributeValues: {
    attributeValue: VariantAttribute;
  }[];
}

export interface Product {
  id: string;
  name: string;
  slug?: string;
  price: number;
  originalPrice?: number;
  image: string;
  images?: string[];
  category: string;
  categoryId?: string;
  badge?: string;
  saveAmount?: number;
  isFeatured?: boolean;
  description?: string;
  shortDesc?: string;
  stock?: number;
  rating?: number;
  sku?: string;
  basePrice?: number;
  salePrice?: number;
  type?: string;
  tags?: string[];
  isActive?: boolean;
  manageStock?: boolean;
  variants?: Variant[];
}

export interface Category {
  id: string;
  name: string;
  image: string;
  slug: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  _count?: { products: number };
}

export interface ComboItemDetails {
  productId: string;
  productName: string;
  productImage?: string;
  productType?: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
  price?: number;
  variants?: Variant[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: "customer" | "admin";
  createdAt?: string;
}

export interface Combo {
  id: string;
  name: string;
  slug: string;
  price: number;
  basePrice: number;
  originalPrice?: number;
  salePrice?: number;
  image?: string;
  images?: string[];
  discount?: string;
  description?: string;
  shortDesc?: string;
  items: ComboItemDetails[];
  categoryId?: string;
  category?: { id: string; name: string } | null;
  isActive?: boolean;
  isFeatured?: boolean;
  tags?: string[];
  seoMeta?: any;
  startDate?: string | null;
  endDate?: string | null;
}

export interface OrderItem {
  id: string;
  productId?: string;
  variantId?: string;
  comboId?: string;
  product?: { id: string; name: string; image?: string; slug?: string };
  combo?: { id: string; name: string; image?: string };
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  displayId: string;
  customerId?: string;
  customer?: { id: string; firstName: string; lastName: string; phoneNumber?: string };
  statusId: string;
  status?: { id: string; name: string; color: string };
  items: OrderItem[];
  subtotal: number;
  shippingCharge: number;
  discount: number;
  total: number;
  shippingAddress?: any;
  createdAt: string;
  guestName?: string;
  guestPhone?: string;
}

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
  comboItems?: ComboItemDetails[];
  comboSelections?: Record<string, string>;
  comboSelectionLabels?: Record<string, string>;
  comboSelectionAttributes?: Record<string, { name: string; value: string }[]>;
  variantId?: string;
  variantLabel?: string;
  variantAttributes?: { name: string; value: string }[];
}
