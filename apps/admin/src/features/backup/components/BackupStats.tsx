import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HardDrive, Database, Clock, Shield } from 'lucide-react'
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
          <Card key={i}><CardHeader><CardTitle className="text-sm animate-pulse bg-muted h-4 w-20 rounded" /></CardHeader></Card>
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
    { icon: Database, label: 'Total Backups', value: String(total) },
    { icon: HardDrive, label: 'Total Size', value: `${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB` },
    { icon: Clock, label: 'Last Backup', value: lastBackup
      ? new Date(lastBackup.createdAt).toLocaleDateString() : 'Never' },
    { icon: Shield, label: 'Locked', value: String(locked) },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
            <s.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{s.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}