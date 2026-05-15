import { apiClient } from '@/lib/api-client'

export interface OrderStatusConfig {
  id: string; name: string; color: string; nextStatuses: string[] | null;
  isInitial: boolean; isFinal: boolean; sortOrder: number;
}

export const orderStatusApi = {
  list: () => apiClient.get<OrderStatusConfig[]>('/order-statuses'),
  update: (id: string, data: Partial<OrderStatusConfig>) => apiClient.put(`/order-statuses/${id}`, data),
}
