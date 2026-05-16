import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { InvoiceTemplate } from '@/features/print/invoice-template'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/op/print/invoice/$id')({
  component: InvoicePage,
})

function InvoicePage() {
  const { id } = Route.useParams() as { id: string }
  const [order, setOrder] = useState<any>(null)

  useEffect(() => {
    apiClient.get(`/orders/${id}`).then(r => { setOrder(r.data); setTimeout(() => window.print(), 500); })
  }, [id])

  return (
    <div>
      <div className="no-print flex items-center justify-between p-4 bg-muted/30 border-b">
        <h1 className="text-lg font-semibold">Invoice Preview — {order?.displayId || id}</h1>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print Invoice</Button>
      </div>
      <div className="p-8 print:p-0 max-w-4xl mx-auto">
        {order ? <InvoiceTemplate order={order} /> : <div className="h-96 bg-muted animate-pulse rounded" />}
      </div>
    </div>
  )
}
