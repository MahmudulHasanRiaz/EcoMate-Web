import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pos_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const sessionId = localStorage.getItem('pos_session_id');
  if (sessionId) {
    config.headers['x-pos-session-id'] = sessionId;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('pos_access_token');
      localStorage.removeItem('pos_session_id');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;

export const loginApi = (username: string, password: string) =>
  api.post('/auth/login', { username, password });

export const openSession = (showroomId: string, openingBalance: number) =>
  api.post('/pos/sessions', { showroomId, openingBalance });

export const getActiveSession = (showroomId: string) =>
  api.get('/pos/sessions/active', { params: { showroomId } });

export const closeSession = (id: string, closingBalance: number, notes?: string) =>
  api.patch(`/pos/sessions/${id}/close`, { closingBalance, notes });

export const createPosOrder = (data: any) =>
  api.post('/pos/orders', data);

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
