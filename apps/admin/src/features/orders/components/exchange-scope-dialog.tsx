import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { exchangeApi } from '@/features/orders/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArrowRightLeft, Minus, Plus, X } from 'lucide-react'
import { ReturnItemPicker, pickerLines } from './return-item-picker'

const errMsg = (e: unknown): string => {
  const err = e as any
  const d = err?.response?.data
  const msg = d?.message ?? d?.error ?? err?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  if (Array.isArray(msg)) return msg.join(', ')
  return 'Failed to create the exchange.'
}

const priceOf = (p: any) => Number(p.salePrice ?? p.basePrice ?? 0)

interface NewItemRow {
  productId: string
  name: string
  quantity: number
  price: number
}

/**
 * Plus-menu → 'Create Exchange Order' (Task 4 Fix 8).
 *
 * The Full/Partial ask comes FIRST:
 * - FULL: the whole original comes back — continue to the exchange order page
 *   (the backend snapshots the full return leg automatically).
 * - PARTIAL: staff picks returning items below + the NEW replacement products
 *   (simple multi-select + product search) → ONE call creates TWO records at
 *   once: the exchange Order and the Return(EXCHANGE) leg. No phantom Orders.
 */
export function ExchangeScopeDialog({
  order,
  open,
  onClose,
}: {
  order: any
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'ask' | 'partial'>('ask')
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({})
  const [returnReason, setReturnReason] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [rows, setRows] = useState<NewItemRow[]>([])
  const [shipping, setShipping] = useState('')
  const [discount, setDiscount] = useState('')

  useEffect(() => {
    if (!open) {
      setStep('ask')
      setReturnQtys({})
      setReturnReason('')
      setSearch('')
      setResults([])
      setRows([])
      setShipping('')
      setDiscount('')
    }
  }, [open ])

  // Product search hits the backend so ANY product is findable by name/SKU.
  useEffect(() => {
    const q = search.trim()
    if (!q || !open || step !== 'partial') { setResults([]); return }
    const t = setTimeout(() => {
      apiClient.get('/products', { params: { search: q, perPage: 10 } })
        .then(r => setResults(r.data?.data || r.data || []))
        .catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [search, open, step])

  const returning = pickerLines(order?.items, returnQtys)

  const mut = useMutation({
    mutationFn: () => exchangeApi.create(order.id, {
      mode: 'PARTIAL',
      returningItems: returning,
      ...(returnReason.trim() ? { returnReason: returnReason.trim() } : {}),
      items: rows.map(r => ({ productId: r.productId, quantity: r.quantity, price: r.price })),
      ...(shipping.trim() !== '' && !isNaN(parseFloat(shipping)) ? { shippingCharge: parseFloat(shipping) } : {}),
      ...(discount.trim() !== '' && !isNaN(parseFloat(discount)) ? { discount: parseFloat(discount) } : {}),
    }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['order', order.id] })
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      onClose()
      toast.success(
        `Partial exchange created — exchange order ${res?.exchange?.displayId ?? ''} + return ${res?.returnRecord?.displayId ?? ''}.`,
      )
      const exId = res?.exchange?.id
      if (exId) navigate({ to: '/op/orders/$id', params: { id: exId } })
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  function addProduct(p: any) {
    if (rows.some(r => r.productId === p.id)) return
    setRows(r => [...r, { productId: p.id, name: p.name ?? 'Item', quantity: 1, price: priceOf(p) }])
    setSearch('')
    setResults([])
  }

  function goFull() {
    onClose()
    navigate({ to: '/op/orders/$id/exchange', params: { id: order.id } })
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className='max-w-2xl max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ArrowRightLeft className='h-4 w-4 text-primary' /> Create Exchange Order
          </DialogTitle>
        </DialogHeader>

        {step === 'ask' ? (
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 py-2'>
            <button
              type='button'
              onClick={goFull}
              className='rounded-xl border border-border p-4 text-left hover:bg-muted/40 transition-colors'
            >
              <div className='text-sm font-semibold mb-1'>Full exchange</div>
              <p className='text-xs text-muted-foreground leading-relaxed'>
                The whole order comes back. Continue to the exchange order page to pick
                the replacement products.
              </p>
            </button>
            <button
              type='button'
              onClick={() => setStep('partial')}
              className='rounded-xl border border-border p-4 text-left hover:bg-muted/40 transition-colors'
            >
              <div className='text-sm font-semibold mb-1'>Partial exchange</div>
              <p className='text-xs text-muted-foreground leading-relaxed'>
                Only some items come back. Pick the returning items and the replacement
                products here — both records are created at once.
              </p>
            </button>
          </div>
        ) : (
          <div className='space-y-4 py-2'>
            <div>
              <div className='text-xs font-semibold mb-1.5'>Returning items (from this order)</div>
              <ReturnItemPicker items={order?.items} value={returnQtys} onChange={setReturnQtys} />
            </div>

            <div>
              <div className='text-xs font-semibold mb-1.5'>Replacement products (new exchange order)</div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder='Search products by name or SKU…'
                aria-label='Search replacement products'
                className='h-9 text-sm'
              />
              {results.length > 0 && (
                <div className='mt-1.5 rounded-lg border border-border divide-y divide-border/50 max-h-44 overflow-y-auto'>
                  {results.map((p: any) => (
                    <button
                      key={p.id}
                      type='button'
                      onClick={() => addProduct(p)}
                      className='w-full text-left px-3 py-2 text-sm hover:bg-muted/40 flex justify-between items-center gap-2'
                    >
                      <span className='truncate'>{p.name}</span>
                      <span className='text-xs text-muted-foreground shrink-0'>৳{priceOf(p).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              )}
              {rows.length > 0 && (
                <div className='mt-2 space-y-1.5'>
                  {rows.map((r) => (
                    <div key={r.productId} className='flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5'>
                      <span className='text-sm font-medium flex-1 truncate'>{r.name}</span>
                      <div className='flex items-center gap-1'>
                        <Button variant='ghost' size='icon' className='h-6 w-6' aria-label={`Decrease quantity for ${r.name}`}
                          onClick={() => setRows(rs => rs.map(x => x.productId === r.productId ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}>
                          <Minus className='h-3 w-3' />
                        </Button>
                        <span className='text-xs font-semibold w-6 text-center'>{r.quantity}</span>
                        <Button variant='ghost' size='icon' className='h-6 w-6' aria-label={`Increase quantity for ${r.name}`}
                          onClick={() => setRows(rs => rs.map(x => x.productId === r.productId ? { ...x, quantity: x.quantity + 1 } : x))}>
                          <Plus className='h-3 w-3' />
                        </Button>
                      </div>
                      <Input
                        type='number' min={0} step='0.01'
                        value={r.price}
                        aria-label={`Price for ${r.name}`}
                        onChange={(e) => setRows(rs => rs.map(x => x.productId === r.productId ? { ...x, price: parseFloat(e.target.value) || 0 } : x))}
                        className='h-7 w-24 text-right text-xs'
                      />
                      <Button variant='ghost' size='icon' className='h-6 w-6 text-destructive' aria-label={`Remove ${r.name}`}
                        onClick={() => setRows(rs => rs.filter(x => x.productId !== r.productId))}>
                        <X className='h-3 w-3' />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
              <div>
                <Label htmlFor='ex-shipping' className='text-xs text-muted-foreground mb-1 block'>Delivery charge (৳, optional)</Label>
                <Input id='ex-shipping' type='number' min={0} step='0.01' value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder='0' className='h-9 text-sm' />
              </div>
              <div>
                <Label htmlFor='ex-discount' className='text-xs text-muted-foreground mb-1 block'>Discount (৳, optional)</Label>
                <Input id='ex-discount' type='number' min={0} step='0.01' value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder='0' className='h-9 text-sm' />
              </div>
              <div>
                <Label htmlFor='ex-return-reason' className='text-xs text-muted-foreground mb-1 block'>Return reason</Label>
                <Input id='ex-return-reason' value={returnReason} onChange={(e) => setReturnReason(e.target.value)} maxLength={500} placeholder='Wrong size' className='h-9 text-sm' />
              </div>
            </div>

            <div className='flex justify-between gap-2'>
              <Button variant='ghost' onClick={() => setStep('ask')}>Back</Button>
              <div className='flex gap-2'>
                <Button variant='outline' onClick={() => onClose()}>Cancel</Button>
                <Button disabled={mut.isPending || returning.length === 0 || rows.length === 0} onClick={() => mut.mutate()}>
                  {mut.isPending ? 'Creating…' : 'Create partial exchange'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
