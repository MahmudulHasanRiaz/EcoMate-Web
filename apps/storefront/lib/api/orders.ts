import apiClient from "../api-client";

export interface CreateOrderItem {
  productId?: string;
  variantId?: string;
  comboId?: string;
  quantity: number;
  price: number;
}

export interface CreateOrderData {
  customerId?: string;
  items: CreateOrderItem[];
  shippingAddress?: Record<string, unknown>;
  customerNotes?: string;
  shippingCharge?: number;
  discount?: number;
  discountType?: string;
  couponCode?: string;
  guestName?: string;
  guestPhone?: string;
  paymentMethod?: string;
  paymentMode?: string;
  partialAmount?: number;
  district?: string;
  thana?: string;
}

export async function createOrder(data: CreateOrderData) {
  const { data: res } = await apiClient.post("/orders", data);
  return res;
}

export async function getOrders(params?: {
  page?: number;
  perPage?: number;
  statusId?: string;
}) {
  const { data } = await apiClient.get("/orders", { params });
  return data;
}

export async function getOrder(id: string) {
  const { data } = await apiClient.get(`/orders/${id}`);
  return data;
}

export async function validateCoupon(code: string) {
  const { data } = await apiClient.get("/coupons");
  const list = Array.isArray(data) ? data : data.data || [];
  return list.find((c: { code: string }) => c.code === code);
}
