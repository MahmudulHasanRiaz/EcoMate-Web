import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

type VariantAttr = {
  attributeValue: {
    id: string
    value: string
    attribute: { id: string; name: string }
  }
}

export type ProductForLabel = {
  id: string
  sku: string | null
  type: 'simple' | 'variable'
  basePrice: string
  salePrice: string | null
  variants: Array<{
    id: string
    sku: string
    price: string | null
    salePrice: string | null
    attributeValues: VariantAttr[]
  }>
}

export type PriceLabelSettings = {
  width: number
  height: number
}

export function usePriceLabelProducts(ids: string[]) {
  return useQuery({
    queryKey: ['price-label-products', ids],
    queryFn: async () => {
      const res = await apiClient.get('/products', {
        params: { ids: ids.join(','), perPage: 500 },
      })
      return (res.data?.data || []) as ProductForLabel[]
    },
    enabled: ids.length > 0,
  })
}

export function usePriceLabelSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: () => apiClient.get('/system-settings').then(r => r.data as Record<string, string>),
    select: (data): PriceLabelSettings => {
      try {
        const parsed = JSON.parse(data.price_label || '{}')
        return {
          width: parsed.width || 50,
          height: parsed.height || 30,
        }
      } catch {
        return { width: 50, height: 30 }
      }
    },
  })
}

export function getVariantAttributes(v: ProductForLabel['variants'][number]): { name: string; value: string }[] {
  return v.attributeValues
    .filter(av => av?.attributeValue)
    .map(av => ({
      name: av.attributeValue.attribute.name,
      value: av.attributeValue.value,
    }))
}
