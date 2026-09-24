import { PackageCheck, Clock, AlertCircle } from 'lucide-react'
import type { PackingStats } from './types'

interface Props {
  stats: PackingStats | undefined
}

export function StatsBar({ stats }: Props) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-semibold select-none">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-success/25 bg-success-soft text-success">
        <PackageCheck className="h-4 w-4 shrink-0 text-success" />
        <span className="tabular-nums">{stats?.packed ?? 0}</span>
        <span className="text-[10px] sm:text-xs font-normal opacity-90">packed</span>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-warning/25 bg-warning-soft text-warning">
        <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
        <span className="tabular-nums">{stats?.held ?? 0}</span>
        <span className="text-[10px] sm:text-xs font-normal opacity-90">held</span>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-info/25 bg-info-soft text-info">
        <Clock className="h-4 w-4 shrink-0 text-info" />
        <span className="tabular-nums">{stats?.pending ?? 0}</span>
        <span className="text-[10px] sm:text-xs font-normal opacity-90">pending</span>
      </div>
    </div>
  )
}
