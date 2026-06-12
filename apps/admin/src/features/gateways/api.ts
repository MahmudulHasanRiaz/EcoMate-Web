import { apiClient } from '@/lib/api-client'

export interface PaymentOption {
  id: string;
  type: 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY';
  name: string;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
  gateways: GatewayConfig[];
}

export interface GatewayConfig {
  id: string;
  code: string;
  name: string;
  type: string;
  paymentOptionType: string;
  paymentOptionName: string;
  enabled: boolean;
  mode: string;
  phoneNumber: string | null;
  credentials: any;
  sortOrder: number;
}

export interface ProductOverride {
  id: string;
  productId: string;
  paymentOptionType: 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY';
  enabled: boolean;
  partialFixedAmount: number | null;
  partialPercentage: number | null;
}

export const productOverrideApi = {
  list: (productId: string) => apiClient.get(`/gateways/product-overrides/${productId}`),
  upsert: (productId: string, type: string, data: { enabled: boolean; partialFixedAmount?: number | null; partialPercentage?: number | null }) =>
    apiClient.put(`/gateways/product-overrides/${productId}/${type}`, data),
  remove: (productId: string, type: string) => apiClient.delete(`/gateways/product-overrides/${productId}/${type}`),
}

export const gatewayApi = {
  listOptions: () => apiClient.get<PaymentOption[]>('/gateways/options'),
  updateOption: (type: string, data: { enabled?: boolean; name?: string; description?: string; sortOrder?: number }) =>
    apiClient.put(`/gateways/options/${type}`, data),
  listGateways: (optionType?: string) => {
    const params = optionType ? { params: { optionType } } : {};
    return apiClient.get<GatewayConfig[]>('/gateways/admin', params);
  },
  updateGateway: (code: string, data: any) => apiClient.put(`/gateways/${code}`, data),
}
