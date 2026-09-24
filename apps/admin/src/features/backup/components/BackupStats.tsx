import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HardDrive, Database, Clock, Shield } from 'lucide-react'
import { riseStyle } from '@/components/ui/dashboard'
import type { BackupJob } from '../types'

interface Props {
  backups: BackupJob[] | undefined
  isLoading: boolean
}

export function BackupStats({ backups, isLoading }: Props) {
  if (isLoading || !backups) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="chart-card rounded-2xl"><CardHeader><CardTitle className="text-sm skeleton-shimmer bg-muted h-4 w-20 rounded" /></CardHeader></Card>
        ))}
      </div>
    )
  }

  const total = backups.length
  const completed = backups.filter((b) => b.status === 'completed').length
  const totalSize = backups.reduce((acc, b) => acc + (Number(b.fileSize) || 0), 0)
  const locked = backups.filter((b) => b.locked).length
  const lastBackup = backups.find((b) => b.status === 'completed')

  const stats = [
    { icon: Database, label: 'Total Backups', value: String(total), accent: 'kpi-accent-info' },
    { icon: HardDrive, label: 'Total Size', value: `${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`, accent: 'kpi-accent-violet' },
    { icon: Clock, label: 'Last Backup', value: lastBackup
      ? new Date(lastBackup.createdAt).toLocaleDateString() : 'Never', accent: 'kpi-accent-success' },
    { icon: Shield, label: 'Locked', value: String(locked), accent: 'kpi-accent-warning' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-rise" style={riseStyle(0)}>
      {stats.map((s) => (
        <Card key={s.label} className={`kpi-card ${s.accent}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
            <span className="kpi-icon-badge shrink-0" aria-hidden>
              <s.icon className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="kpi-value">{s.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}