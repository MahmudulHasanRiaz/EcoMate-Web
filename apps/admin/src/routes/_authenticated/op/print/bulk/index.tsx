import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { StickerTemplate } from '@/features/print/sticker-template'
import { InvoiceTemplate } from '@/features/print/invoice-template'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Printer, Loader2 } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/op/print/bulk/')({
  component: BulkPrint,
  validateSearch: (search: Record<string, unknown>) => ({
    type: (search.type as string) || 'sticker',
    ids: (search.ids as string) || '',
  }),
})

function BulkPrint() {
  const { type, ids } = Route.useSearch()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const idList = ids ? ids.split(',') : []

  useEffect(() => {
    if (!idList.length) return
    setLoading(true)
    const chunks: string[][] = []
    for (let i = 0; i < idList.length; i += 200) chunks.push(idList.slice(i, i + 200))

    Promise.all(chunks.map(chunk =>
      apiClient.post('/orders/bulk', { ids: chunk }).then(r => r.data.orders || [])
    )).then(results => {
      setOrders(results.flat())
      setLoading(false)
    })
  }, [ids])

  return (
    <div>
      <div className="no-print flex items-center justify-between p-4 bg-muted/30 border-b sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-semibold capitalize">{type} Print</h1>
          <p className="text-sm text-muted-foreground">{orders.length} of {idList.length} orders loaded</p>
        </div>
        <Button onClick={() => window.print()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Printer className="h-4 w-4 mr-1" />}
          Print All ({idList.length})
        </Button>
      </div>

      <div className="p-4">
        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin h-8 w-8" /></div>
        ) : type === 'sticker' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 75mm)', gap: '2mm', justifyContent: 'center' }}>
            {orders.map((o: any) => (
              <div key={o.id} className="page-break">
                <StickerTemplate order={o} />
              </div>
            ))}
          </div>
        ) : (
          orders.map((o: any) => (
            <div key={o.id} className="page-break">
              <InvoiceTemplate order={o} />
            </div>
          ))
        )}
      </div>

      <style>{`
        @media print {
          .page-break { page-break-after: always; }
          .page-break:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  )
}
