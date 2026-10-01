import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ordersApi, type OrderOthersInfoResponse } from './api'
import { FieldTable } from './others-info/field-table'
import { CustomerProfileSection } from './others-info/customer-profile-section'
import { PurchaseEvents } from './others-info/purchase-events'
import { cn } from '@/lib/utils'

type View = 'table' | 'json'

const SNAPSHOT_NOTE =
  'Order-owned snapshot — independent from the current customer profile. It changes only through explicit order correction.'

export function OthersInfoDialog({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [section, setSection] = useState('snapshot')
  const [view, setView] = useState<View>('table')

  const { data, isLoading, error } = useQuery({
    queryKey: ['order-others-info', orderId],
    queryFn: () => ordersApi.othersInfo(orderId).then((r) => r.data),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  })

  // Reset the view when the dialog is reopened so stale state never shows.
  useEffect(() => {
    if (open) {
      setSection('snapshot')
      setView('table')
    }
  }, [open])

  const SECTIONS = data
    ? [
        { id: 'snapshot', label: 'Order Snapshot', note: SNAPSHOT_NOTE },
        { id: 'customerProfile', label: 'Customer Profile' },
        { id: 'device', label: 'Device & Request' },
        { id: 'attributionRaw', label: 'Attribution (Raw)' },
        { id: 'attributionResolved', label: 'Attribution (Resolved)' },
        { id: 'trackingIdentifiers', label: 'Tracking IDs' },
        { id: 'purchase', label: 'Purchase Events' },
        { id: 'raw', label: 'Raw JSON' },
      ]
    : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The base DialogContent applies `sm:max-w-lg`, which beats a plain
          `w-` class on desktop. An explicit sm:max-w-* is what actually makes
          this go wide. */}
      <DialogContent className='flex max-h-[92vh] w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[80rem]'>
        <DialogHeader className='shrink-0 border-b px-5 py-3'>
          <DialogTitle className='text-base'>Others Information</DialogTitle>
          <DialogDescription className='text-xs'>
            {data ? (
              <>
                {data.displayId} · captured {new Date(data.createdAt).toLocaleString()}
              </>
            ) : (
              'Order context, attribution and purchase delivery evidence.'
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className='p-8 text-center text-sm text-muted-foreground'>Loading…</div>
        )}

        {error && (
          <div className='p-8 text-center text-sm text-destructive'>
            Could not load Others Information. This view is limited to superadmin and admin.
          </div>
        )}

        {data && (
          <>
            <div className='flex shrink-0 items-center gap-2 border-b px-5 py-2'>
              <div className='no-scrollbar flex flex-1 gap-1 overflow-x-auto sm:hidden'>
                {SECTIONS.map((s) => (
                  <Button
                    key={s.id}
                    variant={section === s.id ? 'secondary' : 'ghost'}
                    size='sm'
                    className='tap-h shrink-0 text-xs'
                    onClick={() => {
                      setSection(s.id)
                    }}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
              <div className='flex shrink-0 items-center gap-1 rounded-lg border bg-muted p-0.5'>
                {(['table', 'json'] as View[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                      view === v ? 'bg-background shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    {v === 'table' ? 'Table' : 'JSON'}
                  </button>
                ))}
              </div>
            </div>

            <div className='flex min-h-0 flex-1 gap-4 overflow-hidden p-4'>
              <nav className='hidden w-44 shrink-0 flex-col gap-0.5 overflow-y-auto sm:flex'>
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSection(s.id)
                    }}
                    className={cn(
                      'rounded-md px-2 py-1 text-left text-xs transition-colors',
                      section === s.id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </nav>

              <div className='flex min-h-0 flex-1 flex-col gap-2'>
                {section === 'purchase' ? (
                  <>
                    {view === 'table' ? (
                      <PurchaseEvents events={data.purchase.events} />
                    ) : (
                      <JsonView value={data.purchase} />
                    )}
                  </>
                ) : section === 'customerProfile' ? (
                  view === 'table' ? (
                    <CustomerProfileSection data={data} />
                  ) : (
                    <JsonView value={data.customerProfile} />
                  )
                ) : section === 'raw' ? (
                  <JsonView value={data.raw} note='Secrets are redacted server-side before this reaches the browser.' />
                ) : (
                  <>
                    {section === 'snapshot' && (
                      <p className='rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground'>
                        {SNAPSHOT_NOTE}
                      </p>
                    )}
                    {view === 'table' ? (
                      <FieldTable
                        fields={(data.sections as any)[section] ?? []}
                        emptyMessage='No data captured for this section.'
                      />
                    ) : (
                      <JsonView value={(data.sections as any)[section] ?? null} />
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function JsonView({ value, note }: { value: unknown; note?: string }) {
  return (
    <div className='flex min-h-0 flex-1 flex-col gap-1.5'>
      {note && <p className='text-[11px] text-muted-foreground'>{note}</p>}
      <pre className='min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed'>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
