import { apiClient } from '@/lib/api-client'

export type StoreLocationType = 'SHOWROOM' | 'BRANCH' | 'OFFICE'

export interface StoreSocial {
  platform: string
  url: string
}

export interface StoreLocation {
  id: string
  name: string
  type: StoreLocationType
  address: string
  city: string | null
  district: string | null
  phone: string | null
  email: string | null
  hours: string | null
  mapUrl: string | null
  socials: StoreSocial[] | null
  photo: string | null
  comingSoon: boolean
  openingDate: string | null
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface StoreLocationInput {
  name: string
  type: StoreLocationType
  address: string
  city?: string
  district?: string
  phone?: string
  email?: string
  hours?: string
  mapUrl?: string
  socials?: StoreSocial[]
  photo?: string
  comingSoon?: boolean
  openingDate?: string
  isActive?: boolean
  sortOrder?: number
}

export const storeLocationsApi = {
  /** Admin list (includes inactive locations). */
  list: () =>
    apiClient.get<StoreLocation[]>('/store-locations/admin').then((r) => r.data),
  get: (id: string) =>
    apiClient.get<StoreLocation>(`/store-locations/admin/${id}`).then((r) => r.data),
  create: (data: StoreLocationInput) =>
    apiClient.post<StoreLocation>('/store-locations', data).then((r) => r.data),
  update: (id: string, data: Partial<StoreLocationInput>) =>
    apiClient.patch<StoreLocation>(`/store-locations/${id}`, data).then((r) => r.data),
  remove: (id: string) =>
    apiClient.delete(`/store-locations/${id}`).then((r) => r.data),
}
