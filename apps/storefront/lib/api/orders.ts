import apiClient from "../api-client";

export interface CreateOrderData {
  customerId: string;
  items: { productId: string; variantId?: string; quantity: number; price: number }[];
  shippingAddress?: Record<string, unknown>;
  customerNotes?: string;
  shippingCharge?: number;
  discount?: number;
  discountType?: string;
  couponCode?: string;
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
  return data.find((c: { code: string }) => c.code === code);
}
