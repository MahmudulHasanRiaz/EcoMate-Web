import { PackageCheck, Clock, AlertCircle } from 'lucide-react'
import type { PackingStats } from './types'

interface Props {
  stats: PackingStats | undefined
}

export function StatsBar({ stats }: Props) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-semibold select-none">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-green-200 bg-green-50 text-green-750 dark:border-green-900/30 dark:bg-green-950/20 dark:text-green-400">
        <PackageCheck className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
        <span>{stats?.packed ?? 0}</span>
        <span className="text-[10px] sm:text-xs font-normal opacity-90">packed</span>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-200 bg-amber-50 text-amber-750 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
        <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{stats?.held ?? 0}</span>
        <span className="text-[10px] sm:text-xs font-normal opacity-90">held</span>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-750 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-400">
        <Clock className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <span>{stats?.pending ?? 0}</span>
        <span className="text-[10px] sm:text-xs font-normal opacity-90">pending</span>
      </div>
    </div>
  )
}
