import { apiClient } from '@/lib/api-client'

export const systemSettingsApi = {
  getAll: () => apiClient.get<Record<string, string>>('/system-settings'),
  getStorageConfig: () => apiClient.get<any>('/system-settings/storage'),
  set: (key: string, value: string) => apiClient.post(`/system-settings/${key}`, { value }),
}
