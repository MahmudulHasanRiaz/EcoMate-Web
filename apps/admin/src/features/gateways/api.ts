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
  /** Whether the gateway's payment option is enabled (POS-visible set). */
  paymentOptionEnabled?: boolean;
  enabled: boolean;
  mode: string;
  phoneNumber: string | null;
  /** Part 1: default settlement account mapped in Settings → Payment Gateways. */
  accountId?: string | null;
  account?: { id: string; code: string; name: string; type: string } | null;
  credentials: any;
  sortOrder: number;
  /** D: tri-state per-gateway overrides — null = use the global default. */
  staffAutoVerifiedOverride?: boolean | null;
  editAllowedOverride?: boolean | null;
  /** D6: per-surface visibility (master `enabled` still rules overall). */
  showOnStorefront?: boolean;
  showOnAdmin?: boolean;
  showOnPos?: boolean;
  /** D6: gateway logo URL (Media Picker), shown at checkout. */
  logoUrl?: string | null;
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
  /** Staff may process refunds (records a refund + the money movement). */
  staffRefundsAllowed: boolean;
}

/** D: effective settings shape of GET /payments/settings (single source). */
export interface GatewayEffectiveSettings {
  code: string;
  name: string;
  type: string;
  staffAutoVerifiedOverride: boolean | null;
  editAllowedOverride: boolean | null;
  effective: { staffAutoVerified: boolean; editAllowed: boolean };
}

export interface EffectivePaymentSettings {
  global: PaymentSettings;
  gateways: GatewayEffectiveSettings[];
}

export type PaymentSettingKey =
  | 'payments.staffAutoVerified'
  | 'payments.editAllowed'
  | 'payments.staffRefundsAllowed';

export const gatewayApi = {
  listOptions: () => apiClient.get<PaymentOption[]>('/gateways/options'),
  updateOption: (type: string, data: { enabled?: boolean; name?: string; description?: string; sortOrder?: number }) =>
    apiClient.put(`/gateways/options/${type}`, data),
  listGateways: (optionType?: string) => {
    const params = optionType ? { params: { optionType } } : {};
    return apiClient.get<GatewayConfig[]>('/gateways/admin', params);
  },
  updateGateway: (code: string, data: any) => apiClient.put(`/gateways/${code}`, data),
  /**
   * D: canonical effective settings — global defaults + per-gateway tri-state
   * overrides + resolved effective values (what the backend enforces).
   */
  getEffectivePaymentSettings: async (): Promise<EffectivePaymentSettings> => {
    const r = await apiClient.get<EffectivePaymentSettings>('/payments/settings');
    return r.data;
  },
  getPaymentSettings: async (): Promise<PaymentSettings> => {
    const r = await apiClient.get<Record<string, string>>('/system-settings');
    const map = (r.data ?? {}) as Record<string, string>;
    return {
      staffAutoVerified: map['payments.staffAutoVerified'] === undefined ? true : map['payments.staffAutoVerified'] === 'true',
      editAllowed: map['payments.editAllowed'] === undefined ? false : map['payments.editAllowed'] === 'true',
      // DEFAULT ON — refunds are not admin-only.
      staffRefundsAllowed: map['payments.staffRefundsAllowed'] === undefined ? true : map['payments.staffRefundsAllowed'] === 'true',
    };
  },
  setPaymentSetting: (key: PaymentSettingKey, value: boolean) =>
    apiClient.post(`/system-settings/${key}`, { value: value ? 'true' : 'false' }),
}
