import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { courierLogos } from '@/features/settings/courier/courier-logos'
import { toast } from 'sonner'
import { Loader2, Shield, ShieldAlert, ShieldCheck, RefreshCw } from 'lucide-react'

const courierMeta: Record<string, { name: string }> = {
  steadfast: { name: 'Steadfast' },
  pathao: { name: 'Pathao' },
  redx: { name: 'RedX' },
  carrybee: { name: 'Carrybee' },
}

type ReportSource = 'actual' | 'normalized' | 'new' | 'none'

interface CourierReport {
  success: number
  cancel: number
  total: number
  successRatio: number | null
  source: ReportSource
  rating?: string
}

interface CourierHistoryEntry {
  report: CourierReport | null
  cached: boolean
  fresh: boolean
  fetchedAt?: string | null
}

function riskLevel(successRatio: number): { label: string; color: string; icon: typeof Shield } {
  if (successRatio >= 90) return { label: 'Low Risk', color: '#22C55E', icon: ShieldCheck }
  if (successRatio >= 70) return { label: 'Medium Risk', color: '#F59E0B', icon: Shield }
  return { label: 'High Risk', color: '#EF4444', icon: ShieldAlert }
}

function pct(ratio: number): string {
  return `${ratio.toFixed(1)}%`
}

function aggregateOverall(
  reports: CourierReport[],
): { delivered: number; cancel: number; total: number; ratio: number } | null {
  const rows = reports.filter(r => r.successRatio != null && r.total > 0)
  if (!rows.length) return null
  const delivered = rows.reduce((acc, r) => acc + r.success, 0)
  const cancel = rows.reduce((acc, r) => acc + r.cancel, 0)
  const total = rows.reduce((acc, r) => acc + r.total, 0)
  return { delivered, cancel, total, ratio: total > 0 ? Math.round((delivered / total) * 10000) / 100 : 0 }
}

const GRID = 'grid grid-cols-[minmax(0,1.5fr)_minmax(34px,0.7fr)_minmax(58px,1.15fr)_minmax(58px,1.15fr)] gap-x-2 items-center'

function RefreshRow({ label, onRefresh, pending }: { label: string; onRefresh: () => void; pending: boolean }) {
  return (
    <div className='flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-muted/60 transition-colors'>
      <span className='text-[11px] font-medium text-foreground'>{label}</span>
      <Button
        variant='outline'
        size='sm'
        className='h-6 gap-1 px-2 text-[10px]'
        onClick={onRefresh}
        disabled={pending}
        aria-label={`Refresh ${label}`}
      >
        {pending ? <Loader2 className='h-3 w-3 animate-spin' /> : <RefreshCw className='h-3 w-3' />}
        {pending ? 'Refreshing…' : 'Refresh'}
      </Button>
    </div>
  )
}

export function CourierCustomerHistoryCard({ phone }: { phone?: string | null }) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['courier-customer-history', phone],
    queryFn: () => apiClient.get(`/couriers/customer-history?phone=${encodeURIComponent(phone || '')}`).then(r => r.data),
    enabled: !!phone,
    refetchInterval: false,
  })

  if (!phone) return null

  const couriers: Record<string, CourierHistoryEntry | null> = data || {}
  const reports = Object.values(couriers)
    .map(e => e?.report)
    .filter((r): r is CourierReport => !!r)
  const overall = aggregateOverall(reports)
  const risk = overall ? riskLevel(overall.ratio) : null

  const latestFetched = Object.values(couriers)
    .map(e => (e?.fetchedAt ? new Date(e.fetchedAt).getTime() : 0))
    .reduce((max, t) => Math.max(max, t), 0)
  const lastUpdated = latestFetched > 0 ? new Date(latestFetched) : null

  async function revalidate(target: string | null) {
    if (refreshing) return
    setRefreshing(target ?? 'all')
    try {
      await apiClient.post('/couriers/customer-history/refresh', {
        phone,
        ...(target ? { courier: target } : {}),
      })
      await queryClient.invalidateQueries({ queryKey: ['courier-customer-history', phone] })
    } catch {
      toast.error('Refresh failed — try again')
    } finally {
      setRefreshing(null)
    }
  }

  return (
    <Card className='rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden'>
      <CardHeader className='p-4 pb-2.5 space-y-1.5'>
        <div className='flex items-center justify-between gap-2'>
          <CardTitle className='text-sm font-semibold tracking-tight'>Customer History</CardTitle>
          {risk && (
            <Badge
              variant='outline'
              className='h-5 shrink-0 gap-1 px-2 text-[10px] font-medium leading-none'
              style={{ color: risk.color, borderColor: `${risk.color}40`, backgroundColor: `${risk.color}0d` }}
            >
              <risk.icon className='h-3 w-3' /> {risk.label}
            </Badge>
          )}
        </div>
        {overall && (
          <p className='text-[11px] text-muted-foreground'>
            <b className='text-foreground tabular-nums'>{overall.total} parcels</b> ·{' '}
            <b className='text-foreground tabular-nums'>{pct(overall.ratio)}</b> Delivery ·{' '}
            <b className='text-foreground tabular-nums'>{pct(100 - overall.ratio)}</b> Cancellation
          </p>
        )}
      </CardHeader>
      <CardContent className='px-4 pb-3.5 pt-0'>
        {isLoading ? (
          <div className='flex justify-center py-5'><Loader2 className='animate-spin h-4 w-4 text-muted-foreground' /></div>
        ) : (
          <div className='space-y-0.5'>
            <div className={`${GRID} border-b border-border/60 pb-1.5 mb-1 text-[10px] font-medium text-muted-foreground`}>
              <span className='leading-none'>Courier</span>
              <span className='text-right leading-none'>Total</span>
              <span className='text-right leading-none'>Delivered</span>
              <span className='text-right leading-none'>Cancelled</span>
            </div>

            {Object.entries(courierMeta).map(([key, meta]) => {
              const entry = couriers[key]
              const report = entry?.report
              const rated = report && report.successRatio != null
              const status = !report || report.source === 'none' ? 'No History' : report.source === 'new' ? 'New Customer' : null

              return (
                <div key={key} className={`${GRID} py-1 px-1 -mx-1 rounded-md hover:bg-muted/30 transition-colors`}>
                  <div className='flex min-w-0 items-center gap-2'>
                    <img
                      src={courierLogos[key]}
                      alt={`${meta.name} logo`}
                      className='h-4.5 w-4.5 shrink-0 rounded-xs bg-muted/60 object-contain p-0.5'
                    />
                    <div className='flex flex-col min-w-0 leading-tight'>
                      <span className='text-[11px] font-medium text-foreground truncate'>{meta.name}</span>
                      {status && <span className='text-[9px] text-muted-foreground font-normal leading-none pt-0.5'>{status}</span>}
                    </div>
                  </div>

                  <span className='text-right text-[11px] tabular-nums font-medium text-foreground/90'>{report?.total ?? '—'}</span>

                  {rated ? (
                    <>
                      <span className='flex items-center justify-end gap-1 text-right'>
                        <b className='text-[11px] tabular-nums font-semibold text-emerald-600 dark:text-emerald-400'>{report.success}</b>
                        <span
                          className='text-[10px] tabular-nums text-muted-foreground'
                          title={report.source === 'normalized' ? 'Normalized (calibrated estimate)' : undefined}
                        >
                          ({pct(report.successRatio!)})
                        </span>
                      </span>
                      <span className='flex items-center justify-end gap-1 text-right'>
                        <b className='text-[11px] tabular-nums font-semibold text-rose-600 dark:text-rose-400'>{report.cancel}</b>
                        <span className='text-[10px] tabular-nums text-muted-foreground'>({pct(100 - report.successRatio!)})</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className='text-right text-[11px] tabular-nums text-muted-foreground'>—</span>
                      <span className='text-right text-[11px] tabular-nums text-muted-foreground'>—</span>
                    </>
                  )}
                </div>
              )
            })}

            {overall ? (
              <div className={`${GRID} mt-2 rounded-lg border border-border/70 bg-muted/40 px-2 py-1.5`}>
                <span className='text-[11px] font-semibold text-foreground'>Overall</span>
                <span className='text-right text-[11px] font-semibold tabular-nums text-foreground'>{overall.total}</span>
                <span className='flex items-center justify-end gap-1 text-right'>
                  <b className='text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400'>{overall.delivered}</b>
                  <span className='text-[10px] tabular-nums text-muted-foreground'>({pct(overall.ratio)})</span>
                </span>
                <span className='flex items-center justify-end gap-1 text-right'>
                  <b className='text-[11px] font-semibold tabular-nums text-rose-600 dark:text-rose-400'>{overall.cancel}</b>
                  <span className='text-[10px] tabular-nums text-muted-foreground'>({pct(100 - overall.ratio)})</span>
                </span>
              </div>
            ) : (
              <p className='pt-1.5 text-[11px] text-muted-foreground'>No history across couriers</p>
            )}

            {lastUpdated && (
              <div className='mt-2.5 flex items-center justify-between gap-2 border-t border-border/40 pt-2'>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-6 gap-1 px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors'
                    >
                      <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} /> Live
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align='start' side='top' className='w-52 p-2 shadow-lg border-border/80'>
                    <p className='px-1 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider'>Refresh courier data</p>
                    <div className='space-y-0.5'>
                      <RefreshRow label='All Couriers' pending={refreshing === 'all'} onRefresh={() => revalidate(null)} />
                      {Object.entries(courierMeta).map(([key, meta]) => (
                        <RefreshRow key={key} label={meta.name} pending={refreshing === key} onRefresh={() => revalidate(key)} />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <span className='text-[9px] leading-none text-muted-foreground/75 tabular-nums'>
                  Last updated ·{' '}
                  {lastUpdated.toLocaleString(undefined, {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}