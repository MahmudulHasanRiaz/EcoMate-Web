import { apiClient } from '@/lib/api-client'

export const referralsApi = {
  list: (params?: { page?: number; perPage?: number }) =>
    apiClient.get('/referrals', { params }),
  get: (id: string) =>
    apiClient.get(`/referrals/${id}`),
  getMy: () =>
    apiClient.get('/referrals/my'),
  claim: (dto: { code: string; phone: string; name?: string }) =>
    apiClient.post('/referrals/claim', dto),
  getLeads: (id: string, params?: { page?: number; perPage?: number }) =>
    apiClient.get(`/referrals/${id}/leads`, { params }),
}
