import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, RotateCw, Link2, Check, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
    <TooltipProvider>
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm font-semibold flex items-center justify-between'>
            <span className='flex items-center gap-1.5'>
              <Link2 className='h-3.5 w-3.5' />
              Customer View Link
            </span>
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type='button' variant='ghost' size='icon' className='h-7 w-7' onClick={handleCopy}>
                    {copied ? <Check className='h-3.5 w-3.5 text-green-500' /> : <Copy className='h-3.5 w-3.5' />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy link</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type='button' variant='ghost' size='icon' className='h-7 w-7' onClick={handleOpen}>
                    <ExternalLink className='h-3.5 w-3.5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open in new tab</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type='button' variant='ghost' size='icon' className='h-7 w-7' onClick={() => setConfirmRotate(true)}>
                    <RotateCw className='h-3.5 w-3.5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Rotate token (invalidates old link)</TooltipContent>
              </Tooltip>
            </div>
          </CardTitle>
        </CardHeader>

        {!viewToken && (
          <CardContent className='pt-0'>
            <div className='flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-2'>
              <AlertCircle className='h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5' />
              <p className='text-xs text-amber-800 dark:text-amber-400'>
                No view token. Click <RotateCw className='h-3 w-3 inline' /> to generate one.
              </p>
            </div>
          </CardContent>
        )}

        <Dialog open={confirmRotate} onOpenChange={(open) => !rotateMut.isPending && setConfirmRotate(open)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rotate customer view link?</DialogTitle>
              <DialogDescription>
                The current link will stop working immediately. Any saved link (browser history, chat, email) will
                show an "Order not found" error. The new link will be the only way to access this order.
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
    </TooltipProvider>
  )
}

export default CustomerViewCard
