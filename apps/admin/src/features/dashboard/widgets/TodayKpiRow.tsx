'use client'

import { useQuery } from '@tanstack/react-query'
import { ShoppingCart, Truck, Wallet, RotateCcw } from 'lucide-react'
import { KpiRow } from '../components/KpiRow'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

export function TodayKpiRow(_props: WidgetProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-today-kpi'],
    queryFn: () => dashboardApi.getTodayKpi(),
    refetchInterval: 30_000,
  })

  const d = data?.data
  const items = [
    { label: "Today's Orders", value: d?.orders ?? '-', icon: <ShoppingCart className="h-5 w-5 text-blue-600" /> },
    { label: 'Delivered', value: d?.delivered ?? '-', icon: <Truck className="h-5 w-5 text-emerald-600" /> },
    { label: 'Pending Payments', value: d?.pendingPayments ?? '-', icon: <Wallet className="h-5 w-5 text-amber-600" /> },
    { label: 'Pending Refunds', value: d?.pendingRefunds ?? '-', icon: <RotateCcw className="h-5 w-5 text-red-600" /> },
  ]

  return <KpiRow items={items} />
}
