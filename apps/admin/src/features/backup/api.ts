import { apiClient } from '@/lib/api-client'
import type { BackupJob, BackupListResponse, BackupSettings } from './types'

export const backupApi = {
  list: (params?: Record<string, any>) =>
    apiClient.get<BackupListResponse>('/admin/backup', { params }).then((r) => r.data),

  get: (id: string) =>
    apiClient.get<BackupJob>(`/admin/backup/${id}`).then((r) => r.data),

  create: (scope: 'db_only' | 'db_files') =>
    apiClient.post<{ id: string }>('/admin/backup', { scope }).then((r) => r.data),

  download: (id: string) =>
    apiClient
      .get(`/admin/backup/${id}/download`, { responseType: 'blob' })
      .then((r) => r.data),

  restore: (id: string) =>
    apiClient.post<{ id: string }>(`/admin/backup/${id}/restore`).then((r) => r.data),

  uploadOnly: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient
      .post<{ id: string }>('/admin/backup/upload', form)
      .then((r) => r.data)
  },

  uploadRestore: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient
      .post<{ id: string }>('/admin/backup/restore/upload', form)
      .then((r) => r.data)
  },

  toggleLock: (id: string, locked: boolean) =>
    apiClient.patch(`/admin/backup/${id}/lock`, { locked }).then((r) => r.data),

  delete: (id: string) =>
    apiClient.delete(`/admin/backup/${id}`).then((r) => r.data),

  getSettings: () =>
    apiClient.get<BackupSettings>('/admin/backup/settings').then((r) => r.data),

  updateSettings: (settings: BackupSettings) =>
    apiClient.put('/admin/backup/settings', settings).then((r) => r.data),
}