import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Shield, ShieldAlert, ShieldCheck, ShieldQuestion, Clock, RefreshCw, ListChecks } from 'lucide-react'

const courierMeta: Record<string, { name: string; color: string }> = {
  steadfast: { name: 'Steadfast', color: '#0EA5E9' },
  pathao: { name: 'Pathao', color: '#F97316' },
  redx: { name: 'RedX', color: '#EF4444' },
  carrybee: { name: 'Carrybee', color: '#8B5CF6' },
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
}

function riskLevel(successRatio: number): { label: string; color: string; icon: typeof Shield } {
  if (successRatio >= 90) return { label: 'Low Risk', color: '#22C55E', icon: ShieldCheck }
  if (successRatio >= 70) return { label: 'Medium Risk', color: '#F59E0B', icon: Shield }
  return { label: 'High Risk', color: '#EF4444', icon: ShieldAlert }
}

function aggregate(
  reports: CourierReport[],
  source: 'actual' | 'normalized',
): { delivered: number; total: number; ratio: number | null } | null {
  const rows = reports.filter(r => r.source === source && r.successRatio != null && r.total > 0)
  if (!rows.length) return null
  const delivered = rows.reduce((acc, r) => acc + r.success, 0)
  const total = rows.reduce((acc, r) => acc + r.total, 0)
  return { delivered, total, ratio: total > 0 ? Math.round((delivered / total) * 10000) / 100 : null }
}

export function CourierCustomerHistoryCard({ phone }: { phone?: string | null }) {
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
  const actualAgg = aggregate(reports, 'actual')
  const normalizedAgg = aggregate(reports, 'normalized')

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-sm font-semibold flex items-center gap-1.5'>
          <Shield className='h-3.5 w-3.5' /> Courier Customer History
        </CardTitle>
      </CardHeader>
      <CardContent className='pt-0 space-y-1'>
        {isLoading ? (
          <div className='flex justify-center py-4'><Loader2 className='animate-spin h-4 w-4' /></div>
        ) : (
          <>
            {Object.entries(courierMeta).map(([key, meta]) => {
              const entry = couriers[key]
              const report = entry?.report
              const rated = report && report.successRatio != null

              return (
                <div key={key} className='flex items-center gap-2 rounded-md px-2 py-1.5 bg-muted/30 border border-transparent hover:border-border transition-colors'>
                  <div className='w-2 h-2 rounded-full shrink-0' style={{ backgroundColor: meta.color }} />
                  <span className='text-xs font-medium w-20 shrink-0'>{meta.name}</span>

                  {!report || report.source === 'none' ? (
                    <>
                      <ShieldQuestion className='h-3 w-3 text-muted-foreground shrink-0' />
                      <span className='text-[11px] text-muted-foreground'>No History</span>
                    </>
                  ) : report.source === 'new' ? (
                    <>
                      <ShieldCheck className='h-3 w-3 text-emerald-500 shrink-0' />
                      <Badge variant='outline' className='text-[9px] leading-none px-1.5 py-0.5 border-emerald-500/40 text-emerald-600'>
                        New Customer
                      </Badge>
                      <span className='text-[11px] text-muted-foreground'>
                        Total <b className='text-foreground'>{report.total}</b> · Success <span className='text-muted-foreground'>N/A</span>
                      </span>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const rl = riskLevel(report.successRatio!)
                        const RiskIcon = rl.icon
                        return (
                          <>
                            <span className='flex items-center gap-1 text-[11px] shrink-0' style={{ color: rl.color }}>
                              <RiskIcon className='h-3 w-3' /> {rl.label}
                            </span>
                            {report.source === 'normalized' && (
                              <Badge variant='secondary' className='text-[9px] leading-none px-1.5 py-0.5'>
                                Normalized
                              </Badge>
                            )}
                            <span className='text-[11px] text-muted-foreground whitespace-nowrap'>
                              Total <b className='text-foreground'>{report.total}</b> · Delivered <b className='text-emerald-600'>{report.success}</b> · Not Delivered <b className='text-red-500'>{report.cancel}</b> · {report.successRatio}%{' '}
                              {report.source === 'normalized' ? 'expected' : 'success'}
                            </span>
                          </>
                        )
                      })()}
                    </>
                  )}

                  {report && (
                    <span className='ml-auto flex items-center gap-1 text-[9px] text-muted-foreground shrink-0'>
                      {entry!.fresh ? (
                        <span className='flex items-center gap-0.5'><RefreshCw className='h-2.5 w-2.5' /> Live</span>
                      ) : entry!.cached ? (
                        <span className='flex items-center gap-0.5'><Clock className='h-2.5 w-2.5' /> Cached</span>
                      ) : null}
                    </span>
                  )}
                </div>
              )
            })}

            <div className='flex items-center gap-2 rounded-md px-2 py-1.5 bg-muted/50 border border-border'>
              <ListChecks className='h-3 w-3 text-muted-foreground shrink-0' />
              <span className='text-[11px] font-semibold'>Overall</span>
              {actualAgg || normalizedAgg ? (
                <span className='text-[11px] text-muted-foreground whitespace-nowrap'>
                  {actualAgg && (
                    <>Actual <b className='text-foreground'>{actualAgg.ratio}%</b> ({actualAgg.delivered}/{actualAgg.total})</>
                  )}
                  {actualAgg && normalizedAgg && <span className='mx-1'>·</span>}
                  {normalizedAgg && (
                    <>Normalized <b className='text-foreground'>{normalizedAgg.ratio}%</b> ({normalizedAgg.delivered}/{normalizedAgg.total})</>
                  )}
                </span>
              ) : (
                <span className='text-[11px] text-muted-foreground'>No history across couriers</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}