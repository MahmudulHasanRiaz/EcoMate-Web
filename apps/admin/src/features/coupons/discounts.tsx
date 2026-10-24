import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { MultiSearchableSelect } from '@/components/ui/multi-searchable-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Loader2, Plus, Pencil, Trash2, Percent, DollarSign } from 'lucide-react'

const errMsg = (e: unknown): string =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
  (e as Error)?.message ||
  'Something went wrong'

const discountsApi = {
  list: () => apiClient.get('/discounts'),
  create: (d: Record<string, unknown>) => apiClient.post('/discounts', d),
  update: (id: string, d: Record<string, unknown>) => apiClient.put(`/discounts/${id}`, d),
  delete: (id: string) => apiClient.delete(`/discounts/${id}`),
}

// datetime-local works in the browser's local timezone; the server stores
// UTC. Converting here (instead of sending the bare "YYYY-MM-DDTHH:mm"
// string, which the server would read as its own local time) is what makes
// "starts 25 Oct at 2pm" actually mean 2pm Dhaka time.
const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const toISO = (local: string): string | null =>
  local ? new Date(local).toISOString() : null

const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString() : '—'

type Discount = Record<string, unknown> & {
  id: string
  title: string
  scope: string
  categoryIds: string[]
  productIds: string[]
  type: string
  value: number | string
  minOrderAmount?: number | string | null
  startsAt?: string | null
  endsAt?: string | null
  isActive: boolean
  _count?: { applications?: number }
}

function scheduleState(d: Discount, now = new Date()): string {
  if (!d.isActive) return 'Inactive'
  if (d.startsAt && new Date(d.startsAt) > now) return 'Scheduled'
  if (d.endsAt && new Date(d.endsAt) < now) return 'Ended'
  return 'Active'
}

export function Discounts() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Discount | null>(null)
  const [form, setForm] = useState({
    title: '', scope: 'SITEWIDE', categoryIds: [] as string[], productIds: [] as string[],
    type: 'percentage', value: '', minOrderAmount: '', startsAt: '', endsAt: '', isActive: true,
  })
  const [productSearch, setProductSearch] = useState('')

  const { data: discounts, isLoading } = useQuery({
    queryKey: ['discounts'],
    queryFn: () => discountsApi.list().then((r) => r.data),
  })
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () =>
      apiClient.get('/categories').then((r) => (Array.isArray(r.data) ? r.data : r.data?.data ?? [])),
  })
  const { data: productResults } = useQuery({
    queryKey: ['discount-product-search', productSearch],
    queryFn: () =>
      apiClient
        .get('/products', { params: { search: productSearch, perPage: 10 } })
        .then((r) => (Array.isArray(r.data) ? r.data : r.data?.data ?? [])),
    enabled: productSearch.trim().length >= 2,
  })

  const categoryOptions = useMemo(() => {
    const list = (categories ?? []) as { id: string; name: string; parentId?: string | null }[]
    const byId = new Map(list.map((c) => [c.id, c]))
    const depth = (c: { id: string; parentId?: string | null }): number => {
      let d = 0
      let cur = c
      while (cur.parentId && byId.get(cur.parentId)) {
        d += 1
        cur = byId.get(cur.parentId)!
      }
      return d
    }
    return list.map((c) => ({
      id: c.id,
      label: c.name,
      depth: depth(c),
      subLabel: c.parentId ? byId.get(c.parentId)?.name : undefined,
    }))
  }, [categories])

  const selectedProducts = useMemo(() => {
    const results = (productResults ?? []) as { id: string; name: string }[]
    const map = new Map(results.map((p) => [p.id, p.name]))
    return form.productIds.map((id) => ({ id, name: map.get(id) ?? id }))
  }, [form.productIds, productResults])

  const saveMut = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      editing ? discountsApi.update(editing.id, d) : discountsApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] })
      setOpen(false)
      setEditing(null)
      resetForm()
      toast.success(editing ? 'Discount updated' : 'Discount created')
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => discountsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] })
      toast.success('Discount deleted')
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const resetForm = () =>
    setForm({
      title: '', scope: 'SITEWIDE', categoryIds: [], productIds: [],
      type: 'percentage', value: '', minOrderAmount: '', startsAt: '', endsAt: '', isActive: true,
    })

  const openEdit = (d: Discount) => {
    setEditing(d)
    setForm({
      title: d.title,
      scope: d.scope,
      categoryIds: d.categoryIds ?? [],
      productIds: d.productIds ?? [],
      type: d.type,
      value: String(d.value),
      minOrderAmount: d.minOrderAmount ? String(d.minOrderAmount) : '',
      startsAt: toLocalInput(d.startsAt),
      endsAt: toLocalInput(d.endsAt),
      isActive: d.isActive,
    })
    setProductSearch('')
    setOpen(true)
  }

  const handleSave = () => {
    const value = parseFloat(form.value)
    if (!form.title.trim()) return toast.error('Title is required')
    if (!value || value <= 0) return toast.error('Value must be greater than 0')
    if (form.type === 'percentage' && value > 100)
      return toast.error('A percentage discount must be between 0 and 100')
    if (form.scope === 'CATEGORY' && form.categoryIds.length === 0)
      return toast.error('Pick at least one category')
    if (form.scope === 'PRODUCT' && form.productIds.length === 0)
      return toast.error('Pick at least one product')
    if (form.startsAt && form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt))
      return toast.error('End must be after start')
    saveMut.mutate({
      title: form.title.trim(),
      scope: form.scope,
      categoryIds: form.scope === 'CATEGORY' ? form.categoryIds : [],
      productIds: form.scope === 'PRODUCT' ? form.productIds : [],
      type: form.type,
      value,
      minOrderAmount: form.minOrderAmount ? parseFloat(form.minOrderAmount) : null,
      startsAt: toISO(form.startsAt),
      endsAt: toISO(form.endsAt),
      isActive: form.isActive,
    })
  }

  const list = (Array.isArray(discounts) ? discounts : (discounts as { data?: unknown[] })?.data ?? []) as Discount[]

  return (
    <>
      <div className='flex items-end justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Automatic Discounts</h3>
          <p className='text-sm text-muted-foreground'>
            Campaign discounts that apply by themselves at checkout — no code needed. Per line, only the
            biggest matching discount applies; a coupon code still stacks on top.
          </p>
        </div>
        <Button size='sm' onClick={() => { resetForm(); setEditing(null); setProductSearch(''); setOpen(true) }}>
          <Plus className='h-4 w-4 mr-1' /> Add Discount
        </Button>
      </div>
      <Card><CardContent className='p-0'>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Title</TableHead><TableHead>Applies To</TableHead><TableHead>Value</TableHead>
            <TableHead>Condition</TableHead><TableHead>Schedule</TableHead><TableHead>Status</TableHead>
            <TableHead>Orders</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={8} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
             list.length ? list.map((d) => (
              <TableRow key={d.id}>
                <TableCell className='font-medium'>{d.title}</TableCell>
                <TableCell>
                  <Badge variant='outline'>
                    {d.scope === 'SITEWIDE' ? 'Entire site' : d.scope === 'CATEGORY' ? `Category (${d.categoryIds.length})` : `Products (${d.productIds.length})`}
                  </Badge>
                  {d.scope === 'CATEGORY' && (
                    <span className='block text-xs text-muted-foreground mt-1'>Includes all subcategories</span>
                  )}
                </TableCell>
                <TableCell>
                  {d.type === 'percentage' ? <><Percent className='h-3 w-3 inline' /> {d.value}%</> : <><DollarSign className='h-3 w-3 inline' /> ৳{d.value} / unit</>}
                </TableCell>
                <TableCell>{d.minOrderAmount ? `Min order ৳${d.minOrderAmount}` : '—'}</TableCell>
                <TableCell className='text-xs'>
                  {d.startsAt ? fmtDate(d.startsAt) : 'Immediately'} → {d.endsAt ? fmtDate(d.endsAt) : 'Open-ended'}
                </TableCell>
                <TableCell>
                  <Badge className={scheduleState(d) === 'Active' ? 'bg-green-500' : scheduleState(d) === 'Scheduled' ? 'bg-blue-500' : ''}>
                    {scheduleState(d)}
                  </Badge>
                </TableCell>
                <TableCell>{d._count?.applications ?? '—'}</TableCell>
                <TableCell className='flex gap-1'>
                  <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(d)}><Pencil className='h-3.5 w-3.5' /></Button>
                  <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => deleteMut.mutate(d.id)}><Trash2 className='h-3.5 w-3.5 text-destructive' /></Button>
                </TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={8} className='text-center py-8 text-muted-foreground'>No automatic discounts yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null) } }}>
        <DialogContent className='max-w-lg max-h-[90vh] overflow-y-auto'>
          <DialogHeader><DialogTitle>{editing ? 'Edit Discount' : 'Add Discount'}</DialogTitle></DialogHeader>
          <div className='space-y-3 py-2'>
            <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder='Eid Sale — 10% off Electronics' /></div>
            <div>
              <Label>Applies To</Label>
              <SearchableSelect
                options={[
                  { id: 'SITEWIDE', label: 'Entire site (all products)' },
                  { id: 'CATEGORY', label: 'Specific categories (incl. subcategories)' },
                  { id: 'PRODUCT', label: 'Specific products' },
                ]}
                value={form.scope}
                onChange={(val) => setForm({ ...form, scope: val })}
                placeholder='Select scope...'
              />
            </div>
            {form.scope === 'CATEGORY' && (
              <div>
                <Label>Categories</Label>
                <MultiSearchableSelect
                  options={categoryOptions}
                  value={form.categoryIds}
                  onChange={(v) => setForm({ ...form, categoryIds: v })}
                  placeholder='Pick categories...'
                />
                <p className='text-xs text-muted-foreground mt-1'>Every product in the picked categories — and all their subcategories — gets this discount.</p>
              </div>
            )}
            {form.scope === 'PRODUCT' && (
              <div>
                <Label>Products</Label>
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder='Type at least 2 characters to search products...'
                />
                {productSearch.trim().length >= 2 && (productResults ?? []).length > 0 && (
                  <div className='border rounded-md mt-1 max-h-40 overflow-y-auto'>
                    {(productResults as { id: string; name: string }[]).map((p) => (
                      <button
                        key={p.id}
                        type='button'
                        className='w-full text-left px-3 py-2 text-sm hover:bg-accent disabled:opacity-50'
                        disabled={form.productIds.includes(p.id)}
                        onClick={() => setForm({ ...form, productIds: [...form.productIds, p.id] })}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
                {selectedProducts.length > 0 && (
                  <div className='flex flex-wrap gap-1 mt-2'>
                    {selectedProducts.map((p) => (
                      <Badge key={p.id} variant='secondary' className='gap-1'>
                        {p.name}
                        <button type='button' onClick={() => setForm({ ...form, productIds: form.productIds.filter((id) => id !== p.id) })}>×</button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <Label>Type</Label>
                <SearchableSelect
                  options={[
                    { id: 'percentage', label: 'Percentage (%)' },
                    { id: 'flat', label: 'Flat (৳ per unit)' },
                  ]}
                  value={form.type}
                  onChange={(val) => setForm({ ...form, type: val })}
                  placeholder='Select type...'
                />
              </div>
              <div><Label>Value</Label><Input type='number' value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'percentage' ? '10' : '100'} /></div>
            </div>
            <div>
              <Label>Minimum Order Amount (optional)</Label>
              <Input type='number' value={form.minOrderAmount} onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })} placeholder='Leave empty for no condition' />
              <p className='text-xs text-muted-foreground mt-1'>The cart subtotal must reach this amount for the discount to apply.</p>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div><Label>Starts At</Label><Input type='datetime-local' value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></div>
              <div><Label>Ends At</Label><Input type='datetime-local' value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></div>
            </div>
            <p className='text-xs text-muted-foreground -mt-1'>Leave start empty to start immediately. Leave end empty to keep it open-ended — you can set an end any time later.</p>
            <div className='flex items-center gap-2'>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMut.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
