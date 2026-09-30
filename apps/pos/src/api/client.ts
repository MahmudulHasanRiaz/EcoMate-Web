import axios from 'axios';
import { useSessionStore } from '../stores/session-store';
import { API_BASE_URL } from '../lib/api-base';
import { buildAnalyticsQuery } from '../lib/analytics-range';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Shared promise to deduplicate concurrent refresh calls within the same tab
let refreshPromise: Promise<{ accessToken: string }> | null = null

// Retry delays for refresh: 2s + 4s + 8s + 16s = 30s total coverage.
// Covers typical backend deployment/restart windows (5-30s) and transient issues.
// The first attempt is immediate (delay 0), so the full sequence covers
// 0s + 2s + 4s + 8s + 16s = 30s from the initial 401.
const REFRESH_RETRY_DELAYS = [0, 2000, 4000, 8000, 16000]
const MAX_REFRESH_RETRIES = REFRESH_RETRY_DELAYS.length

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pos_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const sessionId = useSessionStore.getState().sessionId;
  if (sessionId) {
    config.headers['x-pos-session-id'] = sessionId;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config

    // Not a 401/403 → let error propagate
    if (error.response?.status !== 401 && error.response?.status !== 403) {
      return Promise.reject(error);
    }

    // Already retried → give up
    if (originalRequest._retry) {
      // Clear tokens only on final failure, not intermediate
      localStorage.removeItem('pos_access_token');
      window.location.href = '/pos/';
      return Promise.reject(error);
    }
    originalRequest._retry = true

    // If a refresh is already in flight, wait for it and retry
    if (refreshPromise) {
      try {
        const { accessToken } = await refreshPromise
        localStorage.setItem('pos_access_token', accessToken)
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return api(originalRequest)
      } catch {
        return Promise.reject(error)
      }
    }

    // Exponential backoff: retry refresh up to MAX_REFRESH_RETRIES times
    for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
      const delay = REFRESH_RETRY_DELAYS[attempt]
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      try {
        refreshPromise = axios
          .post<{ accessToken: string }>(
            `${api.defaults.baseURL}/auth/refresh`,
            {},
            { withCredentials: true },
          )
          .then((res) => res.data)

        const data = await refreshPromise
        localStorage.setItem('pos_access_token', data.accessToken)
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`
        return api(originalRequest)
      } catch {
        // Refresh attempt failed — continue to next retry
        refreshPromise = null
      }
    }

    // All retries exhausted
    localStorage.removeItem('pos_access_token');
    window.location.href = '/pos/';
    return Promise.reject(error);
  },
);

export default api;

export const loginApi = (email: string, password: string) =>
  api.post('/auth/login', { email, password });

export const openSession = (showroomId: string, openingBalance: number) =>
  api.post('/pos/sessions', { showroomId, openingBalance });

export const getActiveSession = (showroomId: string) =>
  api.get('/pos/sessions/active', { params: { showroomId } });

export const closeSession = (id: string, closingBalance: number, notes?: string) =>
  api.patch(`/pos/sessions/${id}/close`, { closingBalance, notes });

export const createPosOrder = (data: any, idempotencyKey?: string) =>
  api.post('/pos/orders', data, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {});

export const getPosOrderById = (id: string) =>
  api.get(`/pos/orders/${id}`);

export const getPosProducts = (params: { search?: string; categoryId?: string; barcode?: string; page?: number }) =>
  api.get('/pos/products', { params });

export const getCategoryTree = () =>
  api.get('/categories/tree');

export const findCustomerByPhone = (phone: string) =>
  api.get('/pos/customers', { params: { phone } });

export const quickCreateCustomer = (phone: string, name?: string) =>
  api.post('/pos/customers/quick', { phoneNumber: phone, firstName: name });

export const getShowrooms = () =>
  api.get('/warehouses', { params: { type: 'showroom' } });

export interface PosBranding {
  storeName: string
  storefrontFavicon: string
  adminFavicon: string
}

export const getPosBranding = async (): Promise<PosBranding> => {
  const res = await api.get('/system-settings/branding')
  const d = res.data ?? {}
  return {
    storeName: d.storeName ?? '',
    storefrontFavicon: d.storefrontFavicon ?? '',
    adminFavicon: d.adminFavicon ?? '',
  }
}

export const getPaymentGateways = () =>
  api.get('/gateways');

export const getSessionOrders = (sessionId: string) =>
  api.get(`/pos/sessions/${sessionId}/orders`);

export const getProductAvailability = (productId: string, showroomId: string, variantId?: string) =>
  api.get(`/pos/products/${productId}/availability`, { params: { showroomId, variantId } });

export const createTransferRequest = (data: {
  items: {
    productId: string
    variantId?: string
    sourceWarehouseId: string
    quantity: number
  }[]
  notes?: string
}) => api.post('/pos/transfer-requests', data);

export const validateStock = (data: { items: { productId?: string; variantId?: string; quantity: number }[] }) =>
  api.post('/pos/orders/validate-stock', data);

// ---- POS Sales Analytics (spec 2026-09-29, §5 contract) ----
// Session-scoped via the `x-pos-session-id` header (request interceptor
// above). Never send any showroomId — the server resolves the showroom
// from the session and rejects client-supplied overrides with 400.

export type PosAnalyticsScope = 'showroom' | 'mine';

export type PosAnalyticsPreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'previous_month'
  | 'custom';

export interface PosAnalyticsRangeParams {
  scope: PosAnalyticsScope;
  preset: PosAnalyticsPreset;
  /** Dhaka YYYY-MM-DD. Sent only when preset === 'custom'. */
  from?: string;
  /** Dhaka YYYY-MM-DD. Sent only when preset === 'custom'. */
  to?: string;
}

export interface PosAnalyticsKpis {
  netSales: number;
  grossSales: number;
  refundsTotal: number;
  discountTotal: number;
  totalOrders: number;
  unitsSold: number;
  avgOrderValue: number;
}

export interface PosAnalyticsTransaction {
  orderId: string;
  displayId: string;
  reportingAt: string;
  customerName: string;
  staffName: string;
  itemsSummary: string;
  quantity: number;
  discount: number;
  total: number;
  paymentMethods: string[];
  status: string;
}

export type PosAnalyticsSort = 'reportingAt' | 'total';
export type SortOrder = 'asc' | 'desc';

export interface PosAnalyticsTransactionParams extends PosAnalyticsRangeParams {
  page?: number;
  pageSize?: number;
  sort?: PosAnalyticsSort;
  order?: SortOrder;
}

export const getPosAnalyticsOverview = (params: PosAnalyticsRangeParams) =>
  api.get('/pos/analytics/overview', { params: buildAnalyticsQuery(params) });

export const getPosAnalyticsTransactions = (params: PosAnalyticsTransactionParams) =>
  api.get('/pos/analytics/transactions', { params: buildAnalyticsQuery(params) });

export const exportPosAnalyticsExcel = (
  params: PosAnalyticsRangeParams,
  onDownloadProgress?: (e: { loaded: number; total?: number }) => void,
) =>
  api.get('/pos/analytics/export.xlsx', {
    params: buildAnalyticsQuery(params),
    responseType: 'blob',
    ...(onDownloadProgress ? { onDownloadProgress } : {}),
  });
