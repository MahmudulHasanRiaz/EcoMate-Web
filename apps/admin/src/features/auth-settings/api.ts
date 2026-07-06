import { apiClient } from '@/lib/api-client'

export interface AuthProviderResponse {
  id: string
  providerName: string
  isEnabled: boolean
  clientId: string
  clientSecret: string
}

export const authSettingsApi = {
  list: () => apiClient.get<AuthProviderResponse[]>('/auth-settings'),
  upsert: (provider: string, data: { isEnabled?: boolean; clientId?: string; clientSecret?: string }) =>
    apiClient.put<AuthProviderResponse>(`/auth-settings/${provider}`, data),
}
