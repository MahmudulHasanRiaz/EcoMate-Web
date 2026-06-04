import apiClient from "../api-client";

export interface CreateOrderItem {
  productId?: string;
  variantId?: string;
  comboId?: string;
  comboSelection?: Record<string, string>;
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
  const { data } = await apiClient.get("/coupons/validate", {
    params: { code },
  });
  return data;
}

function getStorefrontApiBase(): string {
  if (
    typeof window !== "undefined" &&
    !window.location.hostname.includes("localhost")
  ) {
    return "/api";
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
}

export async function getOrderForThankYou(
  orderId: string,
  token?: string,
): Promise<unknown> {
  const url = token
    ? `${getStorefrontApiBase()}/orders/${encodeURIComponent(orderId)}?t=${encodeURIComponent(token)}`
    : `${getStorefrontApiBase()}/orders/${encodeURIComponent(orderId)}`;
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to load order (${res.status}): ${body || res.statusText}`,
    );
  }
  return res.json();
}

export async function cancelOrderByToken(orderId: string, token: string) {
  const { data } = await apiClient.post(
    `/orders/${encodeURIComponent(orderId)}/cancel`,
    { token },
  );
  return data;
}

export interface BkashResumeResponse {
  paymentID?: string;
  bkashURL?: string;
  token?: string;
}

export async function resumeBkasPayment(
  orderId: string,
  partialAmount?: number,
  invoiceNo?: string,
): Promise<BkashResumeResponse> {
  const amount =
    typeof partialAmount === "number" && partialAmount > 0
      ? partialAmount
      : 0;
  const { data } = await apiClient.post<BkashResumeResponse>(
    "/payments/bkash/create",
    {
      amount,
      orderId,
      invoiceNo: invoiceNo || orderId,
    },
  );
  return data;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function submitManualPaymentProof(
  orderId: string,
  file: File,
  transactionId?: string,
  amount?: number,
): Promise<unknown> {
  const screenshot = await fileToBase64(file);
  const { data } = await apiClient.post(
    `/payments/${encodeURIComponent(orderId)}`,
    {
      method: "manual",
      amount: typeof amount === "number" ? amount : 0,
      transactionId: transactionId || undefined,
      screenshot,
    },
  );
  return data;
}
