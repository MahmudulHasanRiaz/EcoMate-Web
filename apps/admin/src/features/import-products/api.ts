import { apiClient } from '@/lib/api-client'

export interface ImportError {
  rowNumber: number
  sku: string
  errorType: string
  message: string
}

export interface ImportSummary {
  productsCreated: number
  productsUpdated: number
  productsSkipped: number
  categoriesCreated: number
  categoriesReused: number
  tagsCreated: number
  tagsReused: number
  attributesImported: number
  variantsImported: number
  imagesDownloaded: number
  imagesImported: number
  imagesReused: number
  imagesFailed: number
  errors: number
}

export interface ImportResult {
  summary: ImportSummary
  errors: ImportError[]
}

export const importApi = {
  upload: (file: File, mode?: string, dryRun?: boolean) => {
    const formData = new FormData()
    formData.append('file', file)
    const params = new URLSearchParams()
    if (mode) params.set('mode', mode)
    if (dryRun) params.set('dryRun', 'true')
    const qs = params.toString()
    return apiClient.post<ImportResult>(`/import/products${qs ? `?${qs}` : ''}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  },
}
