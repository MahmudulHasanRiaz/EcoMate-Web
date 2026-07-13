import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

export function useInventoryManagement() {
  return useQuery({
    queryKey: ['inventory-enabled'],
    queryFn: () =>
      apiClient.get('/system-settings/inventory-enabled').then(r => r.data?.enabled ?? false),
    staleTime: 300000,
  })
}
