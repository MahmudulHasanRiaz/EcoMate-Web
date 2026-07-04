import { apiClient } from '@/lib/api-client'

export interface AttributeValueResponse {
  id: string; value: string; hexCode: string | null; sortOrder: number; attributeId: string;
}

export interface AttributeResponse {
  id: string; name: string; createdAt: string;
  values: AttributeValueResponse[];
}

export const attributesApi = {
  list: () => apiClient.get<AttributeResponse[]>('/attributes'),
  get: (id: string) => apiClient.get<AttributeResponse>(`/attributes/${id}`),
  create: (data: { name: string; values?: { value: string; sortOrder?: number }[] }) =>
    apiClient.post<AttributeResponse>('/attributes', data),
  update: (id: string, data: { name?: string }) =>
    apiClient.put<AttributeResponse>(`/attributes/${id}`, data),
  delete: (id: string) => apiClient.delete(`/attributes/${id}`),
  addValue: (attributeId: string, data: { value: string; hexCode?: string; sortOrder?: number }) =>
    apiClient.post(`/attributes/${attributeId}/values`, data),
  removeValue: (attributeId: string, valueId: string) =>
    apiClient.delete(`/attributes/${attributeId}/values/${valueId}`),
}
