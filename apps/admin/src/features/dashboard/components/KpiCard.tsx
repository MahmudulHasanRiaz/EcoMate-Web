import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { ReactNode } from 'react'

interface KpiCardProps {
  label: string
  value: string | number
  icon?: ReactNode
  trend?: { direction: 'up' | 'down'; value: string }
  subtext?: string
}

export function KpiCard({ label, value, icon, trend, subtext }: KpiCardProps) {
  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs md:text-sm text-muted-foreground font-medium">{label}</p>
            <p className="text-xl md:text-2xl font-bold tracking-tight">{value}</p>
            {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
          </div>
          {icon && (
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
              {icon}
            </div>
          )}
        </div>
        {trend && (
          <div className="flex items-center gap-1 mt-3">
            {trend.direction === 'up' ? (
              <TrendingUp className="h-3 w-3 text-emerald-500" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500" />
            )}
            <span className="text-xs font-medium text-emerald-600">{trend.value}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
