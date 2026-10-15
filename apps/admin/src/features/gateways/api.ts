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

export interface PaymentSettings {
  /** S1: staff manual entries skip the verification queue (default ON). */
  staffAutoVerified: boolean;
  /** S2: staff may directly edit recorded payments (default OFF). Manual gateways only. */
  editAllowed: boolean;
}

export type PaymentSettingKey = 'payments.staffAutoVerified' | 'payments.editAllowed';

export const gatewayApi = {
  listOptions: () => apiClient.get<PaymentOption[]>('/gateways/options'),
  updateOption: (type: string, data: { enabled?: boolean; name?: string; description?: string; sortOrder?: number }) =>
    apiClient.put(`/gateways/options/${type}`, data),
  listGateways: (optionType?: string) => {
    const params = optionType ? { params: { optionType } } : {};
    return apiClient.get<GatewayConfig[]>('/gateways/admin', params);
  },
  updateGateway: (code: string, data: any) => apiClient.put(`/gateways/${code}`, data),
  getPaymentSettings: async (): Promise<PaymentSettings> => {
    const r = await apiClient.get<Record<string, string>>('/system-settings');
    const map = (r.data ?? {}) as Record<string, string>;
    return {
      staffAutoVerified: map['payments.staffAutoVerified'] === undefined ? true : map['payments.staffAutoVerified'] === 'true',
      editAllowed: map['payments.editAllowed'] === undefined ? false : map['payments.editAllowed'] === 'true',
    };
  },
  setPaymentSetting: (key: PaymentSettingKey, value: boolean) =>
    apiClient.post(`/system-settings/${key}`, { value: value ? 'true' : 'false' }),
}
