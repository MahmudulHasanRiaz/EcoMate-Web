import { apiClient } from '@/lib/api-client'

export interface GatewayConfig {
  id: string; gateway: string; enabled: boolean; mode: string;
  phoneNumber?: string | null; credentials: any;
}

export const gatewayApi = {
  list: () => apiClient.get<GatewayConfig[]>('/gateways/admin'),
  update: (gateway: string, data: any) => apiClient.put(`/gateways/${gateway}`, data),
}
