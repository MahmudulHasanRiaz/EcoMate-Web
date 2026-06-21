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

export interface OrderImportUploadResponse {
  jobId?: string
  status?: string
  message?: string
  summary?: OrderImportSummary
  errors?: OrderImportError[]
}

export interface OrderImportJobStatus {
  id: string
  type: 'products' | 'orders'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: {
    total: number
    processed: number
  }
  summary: OrderImportSummary | null
  errors: OrderImportError[]
  error?: string
  startedAt: string
  completedAt?: string
}

export const importOrdersApi = {
  upload: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return apiClient.post<OrderImportUploadResponse>('/import/orders', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  },
  getStatus: (jobId: string) => {
    return apiClient.get<OrderImportJobStatus>(`/import/status/${jobId}`)
  },
}
