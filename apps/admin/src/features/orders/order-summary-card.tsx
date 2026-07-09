import { useState, useEffect } from 'react'
import { Pencil, Check, X, DollarSign, Percent, Truck, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'

const nn = (v: number | string) => Number(v)
const fmt = (v: number | string) => nn(v).toFixed(2)

interface ShippingOption {
  id: string
  name: string
  amount: number
}

interface OrderSummaryCardProps {
  subtotal: number
  shippingCharge: number
  discount: number
  discountType: 'flat' | 'percentage'
  total: number
  // edit props
  shippingMode?: string
  shippingOptions?: ShippingOption[]
  selectedShippingOptionId?: string
  shippingChargeOverridden?: boolean
  onSaveShipping: (charge: number, optionId?: string) => void
  onSaveDiscount: (amount: number, type: 'flat' | 'percentage') => void
  isSaving?: boolean
}

export function OrderSummaryCard({
  subtotal,
  shippingCharge,
  discount,
  discountType,
  total,
  shippingMode,
  shippingOptions,
  selectedShippingOptionId,
  shippingChargeOverridden,
  onSaveShipping,
  onSaveDiscount,
  isSaving,
}: OrderSummaryCardProps) {
  // Shipping inline edit state
  const [editShipping, setEditShipping] = useState(false)
  const [draftShipping, setDraftShipping] = useState(String(shippingCharge))
  const [draftShippingOptionId, setDraftShippingOptionId] = useState(selectedShippingOptionId || '')

  // Discount inline edit state
  const [editDiscount, setEditDiscount] = useState(false)
  const [draftDiscount, setDraftDiscount] = useState(String(discount))
  const [draftDiscountType, setDraftDiscountType] = useState<'flat' | 'percentage'>(discountType)

  useEffect(() => { setDraftShipping(String(shippingCharge)) }, [shippingCharge])
  useEffect(() => { setDraftShippingOptionId(selectedShippingOptionId || '') }, [selectedShippingOptionId])
  useEffect(() => { setDraftDiscount(String(discount)) }, [discount])
  useEffect(() => { setDraftDiscountType(discountType) }, [discountType])

  const effectiveDiscount = draftDiscountType === 'percentage'
    ? subtotal * ((parseFloat(draftDiscount) || 0) / 100)
    : (parseFloat(draftDiscount) || 0)

  const previewTotal = Math.max(0, subtotal + (parseFloat(draftShipping) || 0) - effectiveDiscount)

  function cancelShipping() {
    setDraftShipping(String(shippingCharge))
    setDraftShippingOptionId(selectedShippingOptionId || '')
    setEditShipping(false)
  }
  function saveShipping() {
    onSaveShipping(parseFloat(draftShipping) || 0, draftShippingOptionId || undefined)
    setEditShipping(false)
  }
  function cancelDiscount() {
    setDraftDiscount(String(discount))
    setDraftDiscountType(discountType)
    setEditDiscount(false)
  }
  function saveDiscount() {
    onSaveDiscount(parseFloat(draftDiscount) || 0, draftDiscountType)
    setEditDiscount(false)
  }

  const displayTotal = (editShipping || editDiscount) ? previewTotal : total
  const savedDiscount = discountType === 'percentage' ? subtotal * (discount / 100) : discount

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm font-semibold'>Order Summary</CardTitle>
        </CardHeader>
        <CardContent className='space-y-0 text-sm p-4 pt-0'>

          {/* Subtotal */}
          <div className='flex items-center justify-between py-1.5'>
            <span className='text-muted-foreground'>Subtotal</span>
            <span className='font-medium'>৳{fmt(subtotal)}</span>
          </div>

          <Separator className='my-1' />

          {/* Shipping Row */}
          <div className='py-1.5 space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-1.5 text-muted-foreground'>
                <Truck className='h-3.5 w-3.5' />
                <span>Shipping</span>
              </div>
              <div className='flex items-center gap-1'>
                {!editShipping && (
                  <>
                    <span className='font-medium'>৳{fmt(shippingCharge)}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant='ghost' size='icon' className='h-6 w-6 text-muted-foreground hover:text-foreground' onClick={() => setEditShipping(true)}>
                          <Pencil className='h-3 w-3' />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit shipping</TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
            {editShipping && (
              <div className='space-y-2 rounded-lg bg-muted/40 p-2.5 border'>
                {shippingMode === 'options' && (shippingOptions?.length ?? 0) > 0 && (
                  <div className='space-y-1'>
                    <p className='text-xs text-muted-foreground'>Shipping Option</p>
                    <select
                      className='w-full h-8 rounded-md border border-input bg-background px-2 text-xs'
                      value={draftShippingOptionId}
                      onChange={e => {
                        const optId = e.target.value
                        setDraftShippingOptionId(optId)
                        const opt = shippingOptions?.find(o => o.id === optId)
                        if (opt) setDraftShipping(String(opt.amount))
                      }}
                    >
                      <option value=''>Manual amount</option>
                      {shippingOptions?.map(o => (
                        <option key={o.id} value={o.id}>৳{o.amount} — {o.name}</option>
                      ))}
                    </select>
                    {draftShippingOptionId && shippingChargeOverridden && (
                      <p className='text-[10px] text-amber-600'>Amount was manually overridden</p>
                    )}
                  </div>
                )}
                <div className='space-y-1'>
                  <p className='text-xs text-muted-foreground'>Amount</p>
                  <Input type='number' step='0.01' value={draftShipping} onChange={e => setDraftShipping(e.target.value)} className='h-8 text-sm' autoFocus />
                </div>
                <div className='flex gap-1.5 justify-end'>
                  <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={cancelShipping}><X className='h-3 w-3 mr-1' />Cancel</Button>
                  <Button size='sm' className='h-7 text-xs' onClick={saveShipping} disabled={isSaving}><Check className='h-3 w-3 mr-1' />Save</Button>
                </div>
              </div>
            )}
          </div>

          {/* Discount Row */}
          <div className='py-1.5 space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-1.5 text-muted-foreground'>
                <Tag className='h-3.5 w-3.5' />
                <span>Discount</span>
              </div>
              <div className='flex items-center gap-1'>
                {!editDiscount && (
                  <>
                    <span className={savedDiscount > 0 ? 'font-medium text-green-600' : 'font-medium'}>
                      {savedDiscount > 0 ? `-৳${fmt(savedDiscount)}` : '৳0.00'}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant='ghost' size='icon' className='h-6 w-6 text-muted-foreground hover:text-foreground' onClick={() => setEditDiscount(true)}>
                          <Pencil className='h-3 w-3' />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit discount</TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
            {editDiscount && (
              <div className='space-y-2 rounded-lg bg-muted/40 p-2.5 border'>
                <div className='flex gap-1 border rounded-md p-0.5 w-full sm:w-fit bg-background'>
                  <Button variant={draftDiscountType === 'flat' ? 'default' : 'ghost'} size='sm' className='h-6 text-xs px-3 flex-1 sm:flex-none' onClick={() => setDraftDiscountType('flat')}>
                    <DollarSign className='h-3 w-3 mr-0.5' />Flat
                  </Button>
                  <Button variant={draftDiscountType === 'percentage' ? 'default' : 'ghost'} size='sm' className='h-6 text-xs px-3 flex-1 sm:flex-none' onClick={() => setDraftDiscountType('percentage')}>
                    <Percent className='h-3 w-3 mr-0.5' />%
                  </Button>
                </div>
                <Input
                  type='number' step='0.01'
                  value={draftDiscount}
                  onChange={e => setDraftDiscount(e.target.value)}
                  placeholder={draftDiscountType === 'percentage' ? '0–100 %' : 'Amount'}
                  className='h-8 text-sm'
                  autoFocus
                />
                {(parseFloat(draftDiscount) || 0) > 0 && draftDiscountType === 'percentage' && (
                  <p className='text-xs text-muted-foreground'>= ৳{fmt(effectiveDiscount)} off</p>
                )}
                <div className='flex gap-1.5 justify-end'>
                  <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={cancelDiscount}><X className='h-3 w-3 mr-1' />Cancel</Button>
                  <Button size='sm' className='h-7 text-xs' onClick={saveDiscount} disabled={isSaving}><Check className='h-3 w-3 mr-1' />Save</Button>
                </div>
              </div>
            )}
          </div>

          <Separator className='my-1' />

          {/* Total */}
          <div className='flex items-center justify-between py-2'>
            <span className='font-semibold text-base'>Total</span>
            <span className='font-bold text-base'>
              ৳{fmt(displayTotal)}
              {(editShipping || editDiscount) && (
                <span className='text-xs text-muted-foreground font-normal ml-1'>(preview)</span>
              )}
            </span>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}
