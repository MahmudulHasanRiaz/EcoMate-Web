import { apiClient } from '@/lib/api-client'

export interface MediaResponse {
  id: string; filename: string; url: string; mimeType: string; size: number; createdAt: string;
  attachments?: { entityType: string; entityId: string }[];
  _count?: { attachments: number };
}

export interface PaginatedResponse<T> { data: T[]; meta: { total: number; page: number; perPage: number; totalPages: number } }

export const mediaApi = {
  list: (query?: any) => apiClient.get<PaginatedResponse<MediaResponse>>('/media', { params: query }),
  get: (id: string) => apiClient.get<MediaResponse>(`/media/${id}`),
  getAttachments: (id: string) => apiClient.get<{ entityType: string; entityId: string; entityName: string }[]>(`/media/${id}/attachments`),
  delete: (id: string) => apiClient.delete(`/media/${id}`),
}

export const uploadApi = {
  file: (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return apiClient.post<{ url: string; filename: string; size: number }>('/upload/image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
}

export function mediaUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `http://localhost:4000${url}`
}
