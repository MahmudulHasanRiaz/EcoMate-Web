import { apiClient } from '@/lib/api-client'

export interface SettingsResponse {
  profile: {
    username?: string | null
    email?: string | null
    bio?: string | null
    urls: { value: string }[]
  }
  account: {
    name?: string | null
    dob?: string | null
    language?: string | null
  }
  appearance: {
    theme: string
    font: string
  }
  notifications: {
    type: string
    mobile: boolean
    communication_emails: boolean
    social_emails: boolean
    marketing_emails: boolean
    security_emails: boolean
  }
  display: {
    items: string[]
  }
}

export const settingsApi = {
  get: () => apiClient.get<SettingsResponse>('/settings'),

  updateProfile: (data: {
    username?: string
    email?: string
    bio?: string
    urls?: { value: string }[]
  }) => apiClient.put('/settings/profile', data),

  updateAccount: (data: {
    name?: string
    dob?: string
    language?: string
  }) => apiClient.put('/settings/account', data),

  updateAppearance: (data: { theme: string; font: string }) =>
    apiClient.put('/settings/appearance', data),

  updateNotifications: (data: {
    type: string
    mobile?: boolean
    communication_emails?: boolean
    social_emails?: boolean
    marketing_emails?: boolean
    security_emails: boolean
  }) => apiClient.put('/settings/notifications', data),

  updateDisplay: (data: { items: string[] }) =>
    apiClient.put('/settings/display', data),
}
