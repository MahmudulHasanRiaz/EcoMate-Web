'use client'

import { useQuery } from '@tanstack/react-query'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function TopProductsTable({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-top-products', dateRange],
    queryFn: () => analyticsApi.getTopProducts(dateRange),
    refetchInterval: 300_000,
  })

  const products = data?.data || []

  return (
    <WidgetShell title="Top Products" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {products.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="pb-2 font-medium w-8">#</th>
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 font-medium text-right">Sold</th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 10).map((p, i) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 font-medium truncate max-w-[180px]">{p.name}</td>
                  <td className="py-2 text-right font-semibold">{p.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetShell>
  )
}
