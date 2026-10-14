import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronsUpDown, Loader2, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SelectDropdown } from '@/components/select-dropdown'
import { apiClient } from '@/lib/api-client'
import { useDispatchMutations } from './hooks'
import { useLicenseStore } from '@/stores/license-store'
import { getCourierOptions } from './data/data'

type CreateDispatchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const formSchema = z.object({
  orderId: z.string().min(1, 'Order is required'),
  courier: z.string().min(1, 'Courier is required'),
  consignmentId: z.string().optional(),
  trackingCode: z.string().optional(),
  notes: z.string().optional(),
})

type DispatchForm = z.infer<typeof formSchema>

type OrderOption = {
  id: string
  displayId: string
  total?: number
}

function useOrderSearch(term: string) {
  return useQuery({
    queryKey: ['dispatch-order-search', term],
    queryFn: async (): Promise<OrderOption[]> => {
      const res = await apiClient.get('/orders', {
        params: { search: term || undefined, perPage: 8 },
      })
      const body = (res as any)?.data
      return (body?.data ?? body ?? []) as OrderOption[]
    },
  })
}

export function CreateDispatchDialog({
  open,
  onOpenChange,
}: CreateDispatchDialogProps) {
  const { create } = useDispatchMutations()
  const hasFeature = useLicenseStore((s) => s.hasFeature)
  const courierOptions = getCourierOptions(hasFeature)

  const [identifiersOpen, setIdentifiersOpen] = useState(false)
  const [orderSearch, setOrderSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [orderResultsOpen, setOrderResultsOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<OrderOption | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(orderSearch), 300)
    return () => clearTimeout(debounceRef.current)
  }, [orderSearch])

  const { data: orderOptions = [], isFetching: searchingOrders } =
    useOrderSearch(debouncedSearch)

  const form = useForm<DispatchForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      orderId: '',
      courier: '',
      consignmentId: '',
      trackingCode: '',
      notes: '',
    },
  })

  const resetAll = () => {
    form.reset()
    setIdentifiersOpen(false)
    setOrderSearch('')
    setOrderResultsOpen(false)
    setSelectedOrder(null)
  }

  const onSubmit = (data: DispatchForm) => {
    // Blank identifiers are omitted entirely — the row stays NULL until the
    // courier webhook backfills it (never send empty strings to the unique key).
    const payload: Record<string, unknown> = {
      orderId: data.orderId,
      courier: data.courier,
    }
    if (data.notes?.trim()) payload.notes = data.notes.trim()
    if (data.consignmentId?.trim())
      payload.consignmentId = data.consignmentId.trim()
    if (data.trackingCode?.trim())
      payload.trackingCode = data.trackingCode.trim()
    create.mutateAsync(payload).then(() => {
      onOpenChange(false)
      resetAll()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) resetAll()
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Create Dispatch</DialogTitle>
          <DialogDescription>
            Pick the order and courier. Identifiers are optional — the courier
            webhook fills them automatically.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id='dispatch-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4'
          >
            <FormField
              control={form.control}
              name='orderId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Order</FormLabel>
                  <FormControl>
                    <div className='relative'>
                      {selectedOrder ? (
                        <div className='flex items-center justify-between rounded-md border border-input bg-background px-3 py-2'>
                          <span className='font-mono text-sm font-medium'>
                            {selectedOrder.displayId}
                          </span>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='h-6 w-6 p-0'
                            aria-label='Clear selected order'
                            onClick={() => {
                              setSelectedOrder(null)
                              field.onChange('')
                              setOrderSearch('')
                            }}
                          >
                            <X className='h-3.5 w-3.5' />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Input
                            placeholder='Search orders…'
                            value={orderSearch}
                            onChange={(e) => {
                              setOrderSearch(e.target.value)
                              setOrderResultsOpen(true)
                            }}
                            onFocus={() => setOrderResultsOpen(true)}
                          />
                          {orderResultsOpen && orderSearch.trim() && (
                            <div className='absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover shadow-md'>
                              {searchingOrders ? (
                                <div className='flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground'>
                                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                                  Searching…
                                </div>
                              ) : orderOptions.length === 0 ? (
                                <div className='px-3 py-2 text-sm text-muted-foreground'>
                                  No orders found
                                </div>
                              ) : (
                                orderOptions.map((o) => (
                                  <button
                                    key={o.id}
                                    type='button'
                                    className='flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted'
                                    onClick={() => {
                                      setSelectedOrder(o)
                                      field.onChange(o.id)
                                      setOrderResultsOpen(false)
                                    }}
                                  >
                                    <span className='font-mono font-medium'>
                                      {o.displayId}
                                    </span>
                                    {o.total != null && (
                                      <span className='text-xs text-muted-foreground'>
                                        ৳{o.total}
                                      </span>
                                    )}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='courier'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Courier</FormLabel>
                  <SelectDropdown
                    defaultValue={field.value}
                    onValueChange={field.onChange}
                    placeholder='Select courier'
                    items={courierOptions.map((c) => ({
                      label: c.label,
                      value: c.value,
                    }))}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='rounded-md border border-dashed border-border'>
              <button
                type='button'
                className='flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
                onClick={() => setIdentifiersOpen((v) => !v)}
                aria-expanded={identifiersOpen}
              >
                Identifiers (optional)
                <ChevronsUpDown className='h-4 w-4' />
              </button>
              {identifiersOpen && (
                <div className='space-y-4 border-t border-border px-3 py-3'>
                  <p className='text-xs text-muted-foreground'>
                    Leave blank — filled automatically by the courier webhook.
                  </p>
                  <FormField
                    control={form.control}
                    name='consignmentId'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Consignment ID</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder='Enter consignment ID'
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='trackingCode'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tracking Code</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder='Enter tracking code'
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>
            <FormField
              control={form.control}
              name='notes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder='Add notes' rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            form='dispatch-form'
            type='submit'
            disabled={create.isPending}
          >
            {create.isPending && (
              <Loader2 className='mr-2 size-4 animate-spin' />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
