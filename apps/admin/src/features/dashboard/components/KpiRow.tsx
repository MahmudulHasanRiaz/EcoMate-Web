import type { ReactNode } from 'react'
import { KpiCard } from './KpiCard'

interface KpiRowItem {
  label: string
  value: string | number
  icon?: ReactNode
  trend?: { direction: 'up' | 'down'; value: string }
  subtext?: string
}

interface KpiRowProps {
  items: KpiRowItem[]
}

export function KpiRow({ items }: KpiRowProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, i) => (
        <KpiCard key={i} {...item} />
      ))}
    </div>
  )
}
