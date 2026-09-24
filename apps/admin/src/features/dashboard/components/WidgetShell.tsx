import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TONE_SOFT_BADGE, type StatusTone } from '@/components/ui/dashboard'

interface WidgetShellProps {
  title: string
  description?: string
  isLoading: boolean
  error?: Error
  onRetry?: () => void
  children: ReactNode
  className?: string
  action?: ReactNode
  /** Colored header icon badge (chart-card identity). Purely presentational. */
  icon?: ReactNode
  /** Badge tone for the header icon (default info). */
  iconTone?: StatusTone
}

export function WidgetShell({ title, description, isLoading, error, onRetry, children, className = '', action, icon, iconTone = 'info' }: WidgetShellProps) {
  if (error) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mb-2" />
            <p className="text-sm text-muted-foreground mb-3">{error.message || 'Failed to load data'}</p>
            {onRetry && (
              <Button variant="outline" size="sm" className="tap-h" onClick={onRetry}>
                <RefreshCw className="h-3 w-3 mr-1" /> Retry
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
          {description && <Skeleton className="h-3 w-48 mt-1" />}
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn('chart-card', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2.5">
          {icon ? <span className={cn('chart-card-header-icon border', TONE_SOFT_BADGE[iconTone])}>{icon}</span> : null}
          <div>
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            {description && <CardDescription className="text-xs mt-0.5">{description}</CardDescription>}
          </div>
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
