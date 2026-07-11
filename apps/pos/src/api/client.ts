import axios from 'axios';
import { useSessionStore } from '../stores/session-store';

const api = axios.create({
  baseURL: '/api',
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

export const getPaymentGateways = () =>
  api.get('/gateways');

export const getSessionOrders = (sessionId: string) =>
  api.get(`/pos/sessions/${sessionId}/orders`);
