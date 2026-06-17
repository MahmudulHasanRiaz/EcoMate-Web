import { apiClient } from '@/lib/api-client'

export interface OrderImportError {
  rowNumber: number
  orderId: string
  errorType: string
  message: string
}

export interface OrderImportSummary {
  ordersImported: number
  ordersSkipped: number
  customersCreated: number
  customersFound: number
  errors: number
}

export interface OrderImportResult {
  summary: OrderImportSummary
  errors: OrderImportError[]
}

export const importOrdersApi = {
  upload: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return apiClient.post<OrderImportResult>('/import/orders', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
    })
  },
}
