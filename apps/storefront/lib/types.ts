export interface Product {
  id: string;
  name: string;
  slug?: string;
  price: number;
  originalPrice?: number;
  image: string;
  category: string;
  badge?: string;
  saveAmount?: number;
  isFeatured?: boolean;
  description?: string;
  stock?: number;
  rating?: number;
}

export interface Category {
  id: string;
  name: string;
  image: string;
  slug: string;
}

export interface ComboItem {
  sl: number;
  name: string;
  qty: number;
}

export interface Combo {
  id: number;
  name: string;
  price: number;
  originalPrice: number;
  image: string;
  discount: string;
  items: ComboItem[];
  description: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: "customer" | "admin";
  createdAt?: string;
}

export interface CartItem extends Omit<Product, "category"> {
  category?: string;
  quantity: number;
}
