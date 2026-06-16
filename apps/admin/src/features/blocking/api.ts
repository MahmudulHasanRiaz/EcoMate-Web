import { apiClient } from '@/lib/api-client'

export interface BlockedEntry {
  id: string
  entryType: 'ip' | 'phone'
  value: string
  blockType: string
  reason: string | null
  blockedAt: string
  blockedBy: string | null
  isActive: boolean
  whitelisted: boolean
  autoBlocked: boolean
  expiresAt: string | null
}

export interface BlockSettings {
  phoneOrderRestriction: {
    maxOrders: number
    timeWindowMinutes: number
    blockDurationMinutes: number
  }
  ipOrderRestriction: {
    maxOrders: number
    timeWindowMinutes: number
    blockDurationMinutes: number
  }
  autoBlock: {
    failedLoginThreshold: number
    failedLoginWindowMinutes: number
    autoFullBlockIp: boolean
    autoOrderBlockIp: boolean
    autoOrderBlockPhone: boolean
  }
  blockMessages: Record<string, {
    title: string
    message: string
    ctaLabel: string
    ctaAction: string
  }>
}

export const blockedEntriesApi = {
  list: (type?: string, search?: string) =>
    apiClient.get<BlockedEntry[]>('/blocked-entries', { params: { type, search } }).then(r => r.data),

  create: (data: { type: 'ip' | 'phone'; value: string; reason?: string; blockType?: string }) =>
    apiClient.post('/blocked-entries', data).then(r => r.data),

  unblock: (type: string, id: string) =>
    apiClient.post(`/blocked-entries/${type}/${id}/unblock`).then(r => r.data),

  toggleWhitelist: (type: string, id: string) =>
    apiClient.post(`/blocked-entries/${type}/${id}/whitelist`).then(r => r.data),
}

export const blockSettingsApi = {
  get: () =>
    apiClient.get<BlockSettings>('/block-settings').then(r => r.data),

  update: (data: BlockSettings) =>
    apiClient.put('/block-settings', data).then(r => r.data),
}
