import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { StickerTemplate } from '@/features/print/sticker-template'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/op/print/sticker/$id')({
  component: StickerPage,
})

function StickerPage() {
  const { id } = Route.useParams() as { id: string }
  const [order, setOrder] = useState<any>(null)

  useEffect(() => {
    apiClient.get(`/orders/${id}`).then(r => setOrder(r.data))
  }, [id])

  return (
    <div>
      <div className="no-print flex items-center justify-between p-4 bg-muted/30 border-b">
        <h1 className="text-lg font-semibold">Sticker Preview — {order?.displayId || id}</h1>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print Sticker</Button>
      </div>
      <div className="p-4 flex justify-center print:p-0">
        {order ? <StickerTemplate order={order} /> : <div className="w-[75mm] h-[100mm] bg-muted animate-pulse rounded" />}
      </div>
    </div>
  )
}
