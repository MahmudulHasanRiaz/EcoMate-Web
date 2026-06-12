import { apiClient } from '@/lib/api-client'

export interface MediaResponse {
  id: string
  filename: string
  url: string
  mimeType: string
  size: number
  alt?: string | null
  width?: number | null
  height?: number | null
  hash?: string | null
  sourceUrl?: string | null
  createdAt: string
  attachments?: { entityType: string; entityId: string }[]
  _count?: { attachments: number }
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface UploadResult {
  id: string
  url: string
  filename: string
  size: number
  mimeType: string
}

export interface BulkUploadEntry extends Partial<UploadResult> {
  ok: boolean
  error?: string
  originalname: string
}

export const mediaApi = {
  list: (query?: {
    page?: number
    perPage?: number
    search?: string
    type?: string
    attached?: string
  }) =>
    apiClient.get<PaginatedResponse<MediaResponse>>('/media', { params: query }),
  get: (id: string) => apiClient.get<MediaResponse>(`/media/${id}`),
  getAttachments: (id: string) =>
    apiClient.get<{ entityType: string; entityId: string; entityName: string }[]>(
      `/media/${id}/attachments`,
    ),
  updateMeta: (id: string, dto: { alt?: string }) =>
    apiClient.patch<MediaResponse>(`/media/${id}`, dto),
  delete: (id: string, force = false) =>
    apiClient.delete(`/media/${id}${force ? '?force=true' : ''}`),
  bulkDelete: (ids: string[]) =>
    apiClient.post<{ succeeded: number; failed: number }>('/media/bulk-delete', { ids }),
  migrateOrphans: () =>
    apiClient.post<{ scanned: number; migrated: number; failed: number }>(
      '/media/migrate-orphans',
    ),
}

export const uploadApi = {
  file: (file: File, opts?: { filename?: string; alt?: string }) => {
    const fd = new FormData()
    fd.append('file', file)
    if (opts?.filename) fd.append('filename', opts.filename)
    if (opts?.alt) fd.append('alt', opts.alt)
    return apiClient.post<UploadResult>('/upload/image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  bulk: (files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    return apiClient.post<{ data: BulkUploadEntry[] }>('/upload/images', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  fromUrl: (url: string, opts?: { filename?: string; alt?: string }) =>
    apiClient.post<UploadResult>('/upload/from-url', {
      url,
      filename: opts?.filename,
      alt: opts?.alt,
    }),
}

export { appUrl as mediaUrl } from '@/lib/utils'
