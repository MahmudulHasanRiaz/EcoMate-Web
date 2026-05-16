import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { InvoiceTemplate } from '@/features/print/invoice-template'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Printer, X } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/op/print/invoice/$id')({
  component: InvoicePage,
})

function InvoicePage() {
  const { id } = Route.useParams() as { id: string }
  const [order, setOrder] = useState<any>(null)
  const printed = useRef(false)

  useEffect(() => {
    apiClient.get(`/orders/${id}`).then(r => {
      setOrder(r.data)
      if (!printed.current) {
        printed.current = true
        setTimeout(() => window.print(), 300)
      }
    })
  }, [id])

  const handlePrint = () => window.print()
  const handleClose = () => window.close()

  return (
    <div>
      <div className="no-print flex items-center justify-between p-4 bg-muted/30 border-b">
        <h1 className="text-lg font-semibold">Invoice Preview — {order?.displayId || id}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleClose}><X className="h-4 w-4 mr-1" /> Close</Button>
          <Button onClick={handlePrint}><Printer className="h-4 w-4 mr-1" /> Print Invoice</Button>
        </div>
      </div>
      <div className="p-8 print:p-0 max-w-4xl mx-auto">
        {order ? <InvoiceTemplate order={order} /> : <div className="h-96 bg-muted animate-pulse rounded" />}
      </div>
    </div>
  )
}
