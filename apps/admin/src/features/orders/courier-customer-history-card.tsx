import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Shield, ShieldAlert, ShieldCheck, ShieldQuestion, Clock, RefreshCw } from 'lucide-react'

const courierMeta: Record<string, { name: string; color: string }> = {
  steadfast: { name: 'Steadfast', color: '#0EA5E9' },
  pathao: { name: 'Pathao', color: '#F97316' },
  redx: { name: 'RedX', color: '#EF4444' },
  carrybee: { name: 'Carrybee', color: '#8B5CF6' },
}

function riskLevel(successRatio: number, total: number): { label: string; color: string; icon: typeof Shield } {
  if (total === 0) return { label: 'No Data', color: '#9CA3AF', icon: ShieldQuestion }
  if (successRatio >= 90) return { label: 'Low Risk', color: '#22C55E', icon: ShieldCheck }
  if (successRatio >= 70) return { label: 'Medium Risk', color: '#F59E0B', icon: Shield }
  return { label: 'High Risk', color: '#EF4444', icon: ShieldAlert }
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays} days ago`
}

export function CourierCustomerHistoryCard({ phone }: { phone?: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['courier-customer-history', phone],
    queryFn: () => apiClient.get(`/couriers/customer-history?phone=${encodeURIComponent(phone || '')}`).then(r => r.data),
    enabled: !!phone,
    refetchInterval: false,
  })

  if (!phone) return null

  const couriers = data || {}

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-sm font-semibold flex items-center gap-1.5'>
          <Shield className='h-3.5 w-3.5' /> Courier Customer History
        </CardTitle>
      </CardHeader>
      <CardContent className='pt-0 space-y-2'>
        {isLoading ? (
          <div className='flex justify-center py-4'><Loader2 className='animate-spin h-4 w-4' /></div>
        ) : (
          Object.entries(courierMeta).map(([key, meta]) => {
            const entry = couriers[key]
            const report = entry?.report
            const RiskIcon = report ? riskLevel(report.successRatio, report.total).icon : ShieldQuestion
            const riskColor = report ? riskLevel(report.successRatio, report.total).color : '#9CA3AF'

            return (
              <div key={key} className='border rounded-lg p-3 space-y-2'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <div className='w-2 h-2 rounded-full' style={{ backgroundColor: meta.color }} />
                    <span className='text-sm font-medium'>{meta.name}</span>
                  </div>
                  {report && (
                    <div className='flex items-center gap-1 text-[10px] text-muted-foreground'>
                      {entry.fresh ? (
                        <span className='flex items-center gap-0.5'><RefreshCw className='h-2.5 w-2.5' /> Live</span>
                      ) : entry.cached ? (
                        <span className='flex items-center gap-0.5'><Clock className='h-2.5 w-2.5' /> Cached</span>
                      ) : null}
                    </div>
                  )}
                </div>

                {report ? (
                  <>
                    <div className='flex items-center gap-1.5'>
                      <RiskIcon className='h-3.5 w-3.5' style={{ color: riskColor }} />
                      <span className='text-xs font-medium' style={{ color: riskColor }}>
                        {riskLevel(report.successRatio, report.total).label}
                      </span>
                      <span className='text-xs text-muted-foreground ml-auto'>
                        {report.successRatio}% success
                      </span>
                    </div>

                    <div className='grid grid-cols-3 gap-1 text-center'>
                      <div className='bg-muted/50 rounded p-1.5'>
                        <p className='text-xs font-bold'>{report.total}</p>
                        <p className='text-[9px] text-muted-foreground'>Total</p>
                      </div>
                      <div className='bg-emerald-50 dark:bg-emerald-950/30 rounded p-1.5'>
                        <p className='text-xs font-bold text-emerald-600'>{report.success}</p>
                        <p className='text-[9px] text-muted-foreground'>Delivered</p>
                      </div>
                      <div className='bg-red-50 dark:bg-red-950/30 rounded p-1.5'>
                        <p className='text-xs font-bold text-red-500'>{report.cancel}</p>
                        <p className='text-[9px] text-muted-foreground'>Cancelled</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className='text-xs text-muted-foreground'>No data available</p>
                )}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
