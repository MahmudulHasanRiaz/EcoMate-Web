import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { codAlertsApi, type CodMismatchAlert } from '../api'

export interface CodDispatchLink {
  courier?: string | null
  consignmentId?: string | null
  trackingCode?: string | null
  trackingUrl?: string | null
}

export const COD_MISMATCH_INSTRUCTION =
  'The COD amount changed after dispatch. Update the amount manually in the courier panel — the API cannot change it.'

const fmtBdt = (v: number | string) => `৳${Number(v).toLocaleString()}`

function trackingUrlFor(alert: CodMismatchAlert, dispatches?: CodDispatchLink[] | null): string | null {
  const match = (dispatches ?? []).find(
    (d) => d?.consignmentId && d.consignmentId === alert.consignmentId,
  )
  return match?.trackingUrl || null
}

export function CodMismatchBanner({
  orderId,
  due,
  dispatches,
}: {
  orderId: string
  due: number
  dispatches?: CodDispatchLink[] | null
}) {
  const queryClient = useQueryClient()
  const { data: alerts, isLoading } = useQuery({
    queryKey: ['order-cod-alerts', orderId],
    queryFn: () => codAlertsApi.list(orderId),
    // Server-driven and persistent: always refetch on mount/focus, never
    // auto-dismiss. Stale-while-revalidate keeps the banner honest.
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })

  const resolveMut = useMutation({
    mutationFn: (alertId: string) => codAlertsApi.resolve(orderId, alertId),
    onSuccess: () => {
      toast.success('COD alert marked resolved')
      queryClient.invalidateQueries({ queryKey: ['order-cod-alerts', orderId] })
      // Resolve writes a timeline note server-side — refresh the detail view.
      queryClient.invalidateQueries({ queryKey: ['order', orderId] })
    },
    onError: (e: unknown) => {
      const err = e as any
      toast.error(err?.response?.data?.message || 'Failed to resolve alert')
    },
  })

  const open = (alerts ?? []).filter((a) => a.status === 'open')
  if (isLoading || open.length === 0) return null

  return (
    <div className="space-y-2.5" data-testid="cod-mismatch-banner">
      {open.map((alert) => {
        const courierAmount = Number(alert.courierAmount)
        const systemDue = Number(alert.systemDue ?? due)
        const diff = Math.abs(courierAmount - systemDue)
        const url = trackingUrlFor(alert, dispatches)
        return (
          <div
            key={alert.id}
            className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-3.5 sm:p-4 space-y-2"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0" />
              <span className="text-sm font-semibold text-foreground">COD mismatch</span>
              <Badge variant="outline" className="text-[11px] capitalize border-amber-500/40 text-amber-700 dark:text-amber-400">
                {alert.courier}
              </Badge>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary hover:underline"
                >
                  {alert.consignmentId}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="font-mono text-xs font-semibold text-foreground">
                  {alert.consignmentId}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground">
              Courier COD <strong>{fmtBdt(courierAmount)}</strong>
              {' vs '}System due <strong>{fmtBdt(systemDue)}</strong>
              <span className="text-muted-foreground"> (Difference {fmtBdt(diff)})</span>
            </p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {COD_MISMATCH_INSTRUCTION}
            </p>
            <div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs font-medium border-amber-500/40 hover:bg-amber-500/10"
                disabled={resolveMut.isPending}
                onClick={() => resolveMut.mutate(alert.id)}
              >
                {resolveMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Mark resolved
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
