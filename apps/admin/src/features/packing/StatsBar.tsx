import { PackageCheck, Clock, AlertCircle } from 'lucide-react'
import type { PackingStats } from './types'

interface Props {
  stats: PackingStats | undefined
}

export function StatsBar({ stats }: Props) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-1.5 text-green-600">
        <PackageCheck className="h-4 w-4" />
        <span className="font-medium">{stats?.packed ?? 0}</span>
        <span className="text-muted-foreground">packed</span>
      </div>
      <div className="flex items-center gap-1.5 text-amber-600">
        <AlertCircle className="h-4 w-4" />
        <span className="font-medium">{stats?.held ?? 0}</span>
        <span className="text-muted-foreground">held</span>
      </div>
      <div className="flex items-center gap-1.5 text-blue-600">
        <Clock className="h-4 w-4" />
        <span className="font-medium">{stats?.pending ?? 0}</span>
        <span className="text-muted-foreground">pending</span>
      </div>
    </div>
  )
}
