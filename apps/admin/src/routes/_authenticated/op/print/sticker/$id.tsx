import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { StickerTemplate } from '@/features/print/sticker-template'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Printer, X } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/op/print/sticker/$id')({
  component: StickerPage,
})

function StickerPage() {
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
        <h1 className="text-lg font-semibold">Sticker Preview — {order?.displayId || id}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleClose}><X className="h-4 w-4 mr-1" /> Close</Button>
          <Button onClick={handlePrint}><Printer className="h-4 w-4 mr-1" /> Print Sticker</Button>
        </div>
      </div>
      <div className="p-4 flex justify-center print:p-0">
        {order ? <StickerTemplate order={order} /> : <div className="w-[75mm] h-[100mm] bg-muted animate-pulse rounded" />}
      </div>
    </div>
  )
}
