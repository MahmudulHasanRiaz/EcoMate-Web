import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, RotateCw, Link2, Check, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ordersApi } from '@/features/orders/api'
import { buildThankYouUrl } from '@/lib/utils'
import type { OrderResponse } from '@/features/orders/api'

export interface CustomerViewCardProps {
  order: OrderResponse
}

export function CustomerViewCard({ order }: CustomerViewCardProps) {
  const queryClient = useQueryClient()
  const [viewToken, setViewToken] = useState<string | null>(order.viewToken ?? null)
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)

  const url = buildThankYouUrl(order.id, viewToken)

  const rotateMut = useMutation({
    mutationFn: () => ordersApi.rotateViewToken(order.id).then((r) => r.data),
    onSuccess: (data) => {
      setViewToken(data.viewToken)
      queryClient.invalidateQueries({ queryKey: ['order', order.id] })
      toast.success('New view link generated. Old link is now invalid.')
      setConfirmRotate(false)
    },
    onError: (e: unknown) => {
      toast.error((e as Error).message || 'Failed to rotate token')
    },
  })

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Please copy manually.')
    }
  }

  function handleOpen() {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-base flex items-center gap-2'>
          <Link2 className='h-4 w-4' />
          Customer View
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='text-xs text-muted-foreground'>
          Share this link with the customer so they can resume payment, view order details, or cancel the order.
        </p>

        <div className='flex gap-2'>
          <Input
            value={url}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            className='text-xs font-mono h-8'
          />
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={handleCopy}
            className='shrink-0'
            title='Copy link'
          >
            {copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
          </Button>
        </div>

        <div className='flex gap-2'>
          <Button type='button' variant='outline' size='sm' onClick={handleOpen} className='flex-1'>
            <ExternalLink className='h-3.5 w-3.5 mr-1' /> Open in new tab
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setConfirmRotate(true)}
            className='flex-1'
          >
            <RotateCw className='h-3.5 w-3.5 mr-1' /> Rotate Token
          </Button>
        </div>

        {!viewToken && (
          <div className='flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-2'>
            <AlertCircle className='h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5' />
            <p className='text-xs text-amber-800'>
              This order does not have a view token. Click <strong>Rotate Token</strong> to generate one.
            </p>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmRotate} onOpenChange={(open) => !rotateMut.isPending && setConfirmRotate(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate customer view link?</DialogTitle>
            <DialogDescription>
              The current link will stop working immediately. Any saved link (browser history, chat, email) will
              show an "Order not found" error. The new link above will be the only way to access this order.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirmRotate(false)} disabled={rotateMut.isPending}>
              Cancel
            </Button>
            <Button onClick={() => rotateMut.mutate()} disabled={rotateMut.isPending}>
              {rotateMut.isPending ? 'Rotating…' : 'Yes, rotate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export default CustomerViewCard
