import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { mediaUrl } from '@/features/orders/api'
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
import { SafeImage } from '@/components/safe-image'
import { Loader2, Plus, Pencil, Trash2, Percent, DollarSign, Package, X } from 'lucide-react'

const errMsg = (e: unknown): string =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
  (e as Error)?.message ||
  'Something went wrong'

const discountsApi = {
  list: () => apiClient.get('/discounts'),
  create: (d: Record<string, unknown>) => apiClient.post('/discounts', d),
  update: (id: string, d: Record<string, unknown>) => apiClient.put(`/discounts/${id}`, d),
  delete: (id: string) => apiClient.delete(`/discounts/${id}`),
  applications: (id: string) => apiClient.get(`/discounts/${id}/applications`),
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

// Short, no-seconds dates (the old toLocaleString showed seconds, e.g.
// "10/24/2026, 8:00:00 AM", and no timezone anywhere on this page).
const fmtDate = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : '—'

const fmtMoney = (v: number | string | null | undefined): string =>
  v === null || v === undefined || v === '' ? '—' : `৳${Number(v).toFixed(2)}`

type Discount = Record<string, unknown> & {
  id: string
  title: string
  scope: string
  categoryIds: string[]
  productIds: string[]
  variantIds?: string[]
  scopeNames?: string[]
  type: string
  value: number | string
  minOrderAmount?: number | string | null
  minQuantity?: number | null
  excludeSaleItems?: boolean
  maxDiscountAmount?: number | string | null
  combineWithCoupon?: boolean
  maxUses?: number | null
  maxUsesPerCustomer?: number | null
  firstOrderOnly?: boolean
  priority?: number
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

type ProductRow = {
  id: string
  name: string
  sku?: string | null
  type?: string
  images?: string[]
  basePrice?: number | string | null
  salePrice?: number | string | null
  variants?: { id: string; sku?: string | null; price?: number | string | null; salePrice?: number | string | null }[]
}

const productPrice = (p: ProductRow): number => {
  if (p.type === 'variable' && p.variants?.length) {
    return Math.min(...p.variants.map((v) => Number(v.salePrice ?? v.price ?? 0)))
  }
  return Number(p.salePrice ?? p.basePrice ?? 0)
}

const emptyForm = {
  title: '', scope: 'SITEWIDE', categoryIds: [] as string[], productIds: [] as string[],
  variantIds: [] as string[],
  type: 'percentage', value: '', minOrderAmount: '', minQuantity: '',
  excludeSaleItems: false, maxDiscountAmount: '', combineWithCoupon: true,
  maxUses: '', maxUsesPerCustomer: '', firstOrderOnly: false, priority: '0',
  startsAt: '', endsAt: '', isActive: true,
}

export function Discounts() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Discount | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [productSearch, setProductSearch] = useState('')
  // Full product rows for everything ever selected (search results are
  // transient, but variant options + selected names must survive them).
  const [productCache, setProductCache] = useState<Record<string, ProductRow>>({})
  const [applicationsFor, setApplicationsFor] = useState<Discount | null>(null)

  const updateForm = (patch: Partial<typeof emptyForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setErrors({})
  }

  const { data: discounts, isLoading } = useQuery({
    queryKey: ['discounts'],
    queryFn: () => discountsApi.list().then((r) => r.data),
  })
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () =>
      apiClient.get('/categories').then((r) => (Array.isArray(r.data) ? r.data : r.data?.data ?? [])),
  })
  const { data: productResults, isFetching: productSearching } = useQuery({
    queryKey: ['discount-product-search', productSearch],
    queryFn: () =>
      apiClient
        .get('/products', { params: { search: productSearch, perPage: 20 } })
        .then((r) => (Array.isArray(r.data) ? r.data : r.data?.data ?? [])),
    enabled: productSearch.trim().length >= 2,
  })
  const { data: applications } = useQuery({
    queryKey: ['discount-applications', applicationsFor?.id],
    queryFn: () => discountsApi.applications(applicationsFor!.id).then((r) => r.data),
    enabled: !!applicationsFor,
  })

  // Merge search results into the cache so selected rows keep their
  // image/SKU/price/variants after the search text changes.
  useEffect(() => {
    const results = (productResults ?? []) as ProductRow[]
    if (!results.length) return
    setProductCache((cache) => {
      let changed = false
      const next = { ...cache }
      for (const p of results) {
        if (!next[p.id]) { next[p.id] = p; changed = true }
      }
      return changed ? next : cache
    })
  }, [productResults])

  const categoryOptions = useMemo(() => {
    const list = (categories ?? []) as { id: string; name: string; parentId?: string | null }[]
    const byId = new Map(list.map((c) => [c.id, c]))
    // Full breadcrumb path ("Men › Shirts") instead of the old flat
    // indented list, where a child showed only "— Shirts" and its parent
    // as small grey text on the right.
    const path = (c: { id: string; name: string; parentId?: string | null }): string => {
      const parts = [c.name]
      let cur = c
      while (cur.parentId && byId.get(cur.parentId)) {
        cur = byId.get(cur.parentId)!
        parts.unshift(cur.name)
      }
      return parts.join(' › ')
    }
    return list.map((c) => ({ id: c.id, label: path(c) }))
  }, [categories])

  const selectedProducts = useMemo(() => {
    const results = (productResults ?? []) as ProductRow[]
    const map = new Map(results.map((p) => [p.id, p]))
    return form.productIds.map((id) => productCache[id] ?? map.get(id) ?? { id, name: id })
  }, [form.productIds, productResults, productCache])

  // Variant options come from the selected products only. A variant's
  // label carries its product so "Large" under two products stays distinct.
  const variantOptions = useMemo(() => {
    const opts: { id: string; label: string; subLabel: string }[] = []
    for (const p of selectedProducts) {
      for (const v of p.variants ?? []) {
        opts.push({
          id: v.id,
          label: `${p.name} — ${v.sku ?? `Variant ${v.id.slice(0, 8)}`}`,
          subLabel: `৳${Number(v.salePrice ?? v.price ?? 0).toFixed(2)}`,
        })
      }
    }
    return opts
  }, [selectedProducts])

  // Drop variant narrowing for products that left the selection, but only
  // where the mapping is known (unknown mappings are kept and the server
  // rejects them with a clear error on save).
  const pruneVariants = (productIds: string[]) => {
    const known = new Map<string, string>()
    for (const p of selectedProducts) {
      for (const v of p.variants ?? []) known.set(v.id, p.id)
    }
    const kept = form.variantIds.filter((vid) => {
      const owner = known.get(vid)
      return owner === undefined || productIds.includes(owner)
    })
    if (kept.length !== form.variantIds.length) updateForm({ productIds, variantIds: kept })
    else updateForm({ productIds })
  }

  const saveMut = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      editing ? discountsApi.update(editing.id, d) : discountsApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] })
      setOpen(false)
      setEditing(null)
      setForm(emptyForm)
      setErrors({})
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

  const resetForm = () => {
    setForm(emptyForm)
    setErrors({})
  }

  const openEdit = (d: Discount) => {
    setEditing(d)
    setForm({
      ...emptyForm,
      title: d.title,
      scope: d.scope,
      categoryIds: d.categoryIds ?? [],
      productIds: d.productIds ?? [],
      variantIds: d.variantIds ?? [],
      type: d.type,
      value: String(d.value),
      minOrderAmount: d.minOrderAmount ? String(d.minOrderAmount) : '',
      minQuantity: d.minQuantity ? String(d.minQuantity) : '',
      excludeSaleItems: d.excludeSaleItems ?? false,
      maxDiscountAmount: d.maxDiscountAmount ? String(d.maxDiscountAmount) : '',
      combineWithCoupon: d.combineWithCoupon ?? true,
      maxUses: d.maxUses ? String(d.maxUses) : '',
      maxUsesPerCustomer: d.maxUsesPerCustomer ? String(d.maxUsesPerCustomer) : '',
      firstOrderOnly: d.firstOrderOnly ?? false,
      priority: String(d.priority ?? 0),
      startsAt: toLocalInput(d.startsAt),
      endsAt: toLocalInput(d.endsAt),
      isActive: d.isActive,
    })
    setProductSearch('')
    setOpen(true)
    // Variant options for an edited discount need the products' variants,
    // which the list response may not carry for these ids — fetch them.
    for (const pid of d.productIds ?? []) {
      if (!productCache[pid]) {
        apiClient.get(`/products/${pid}`).then((r) => {
          const p = r.data?.data ?? r.data
          if (p?.id) setProductCache((cache) => ({ ...cache, [p.id]: p }))
        }).catch(() => undefined)
      }
    }
  }

  const handleSave = () => {
    const nextErrors: Record<string, string> = {}
    const value = parseFloat(form.value)
    if (!form.title.trim()) nextErrors.title = 'Title is required'
    if (!value || value <= 0) nextErrors.value = 'Value must be greater than 0'
    if (form.type === 'percentage' && value > 100)
      nextErrors.value = 'A percentage discount must be between 0 and 100'
    if (form.scope === 'CATEGORY' && form.categoryIds.length === 0)
      nextErrors.scope = 'Pick at least one category'
    if (form.scope === 'PRODUCT' && form.productIds.length === 0)
      nextErrors.scope = 'Pick at least one product'
    if (form.startsAt && form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt))
      nextErrors.dates = 'End must be after start'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    saveMut.mutate({
      title: form.title.trim(),
      scope: form.scope,
      categoryIds: form.scope === 'CATEGORY' ? form.categoryIds : [],
      productIds: form.scope === 'PRODUCT' ? form.productIds : [],
      variantIds: form.scope === 'PRODUCT' ? form.variantIds : [],
      type: form.type,
      value,
      minOrderAmount: form.minOrderAmount ? parseFloat(form.minOrderAmount) : null,
      minQuantity: form.minQuantity ? parseInt(form.minQuantity, 10) : null,
      excludeSaleItems: form.excludeSaleItems,
      maxDiscountAmount: form.maxDiscountAmount ? parseFloat(form.maxDiscountAmount) : null,
      combineWithCoupon: form.combineWithCoupon,
      maxUses: form.maxUses ? parseInt(form.maxUses, 10) : null,
      maxUsesPerCustomer: form.maxUsesPerCustomer ? parseInt(form.maxUsesPerCustomer, 10) : null,
      firstOrderOnly: form.firstOrderOnly,
      priority: parseInt(form.priority, 10) || 0,
      startsAt: toISO(form.startsAt),
      endsAt: toISO(form.endsAt),
      isActive: form.isActive,
    })
  }

  const list = (Array.isArray(discounts) ? discounts : (discounts as { data?: unknown[] })?.data ?? []) as Discount[]
  const appRows = (Array.isArray(applications) ? applications : (applications as { data?: unknown[] })?.data ?? []) as {
    id: string; amount: number | string; createdAt: string; order?: { displayId?: string; total?: number | string }
  }[]

  const scopeLabel = (d: Discount): string => {
    if (d.scope === 'SITEWIDE') return 'Entire site'
    const names = d.scopeNames ?? []
    const count = d.scope === 'CATEGORY' ? d.categoryIds.length : d.productIds.length
    if (names.length > 0) return names.join(', ')
    return `${count} selected`
  }

  return (
    <>
      <div className='flex items-end justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Automatic Discounts</h3>
          <p className='text-sm text-muted-foreground'>
            Campaign discounts that apply by themselves at checkout — no code needed. Per line, only the
            highest-priority matching discount applies (ties go to the biggest, then the oldest). A coupon
            code stacks on top unless the discount opts out.
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
            <TableHead>Condition</TableHead><TableHead>Starts</TableHead><TableHead>Ends</TableHead>
            <TableHead>Status</TableHead><TableHead>Orders</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={9} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
             list.length ? list.map((d) => (
              <TableRow key={d.id}>
                <TableCell className='font-medium'>{d.title}</TableCell>
                <TableCell>
                  <Badge variant='outline'>
                    {d.scope === 'SITEWIDE' ? 'Entire site' : d.scope === 'CATEGORY' ? 'Category' : 'Products'}
                  </Badge>
                  {d.scope !== 'SITEWIDE' && (
                    <span className='block text-xs text-muted-foreground mt-1'>{scopeLabel(d)}</span>
                  )}
                  {d.scope === 'CATEGORY' && (
                    <span className='block text-xs text-muted-foreground'>Includes all subcategories</span>
                  )}
                  {d.scope === 'PRODUCT' && (d.variantIds?.length ?? 0) > 0 && (
                    <span className='block text-xs text-muted-foreground'>Only {d.variantIds!.length} variant(s)</span>
                  )}
                </TableCell>
                <TableCell>
                  {d.type === 'percentage' ? <><Percent className='h-3 w-3 inline' /> {d.value}%</> : <><DollarSign className='h-3 w-3 inline' /> ৳{d.value} / unit</>}
                  {d.maxDiscountAmount ? <span className='block text-xs text-muted-foreground'>max {fmtMoney(d.maxDiscountAmount)} / order</span> : null}
                  {(d.priority ?? 0) !== 0 && <span className='block text-xs text-muted-foreground'>Priority {d.priority}</span>}
                </TableCell>
                <TableCell className='text-xs'>
                  {d.minOrderAmount
                    ? <span className='block'>Min {fmtMoney(d.minOrderAmount)}{d.scope === 'SITEWIDE' ? '' : ' in scope'}</span>
                    : null}
                  {d.minQuantity
                    ? <span className='block'>Min {d.minQuantity} unit(s){d.scope === 'SITEWIDE' ? '' : ' in scope'}</span>
                    : null}
                  {d.excludeSaleItems ? <span className='block'>Excludes sale items</span> : null}
                  {d.firstOrderOnly ? <span className='block'>First orders only</span> : null}
                  {!d.minOrderAmount && !d.minQuantity && !d.excludeSaleItems && !d.firstOrderOnly ? 'No minimum' : null}
                </TableCell>
                <TableCell className='text-xs'>{d.startsAt ? fmtDate(d.startsAt) : 'Immediately'}</TableCell>
                <TableCell className='text-xs'>{d.endsAt ? fmtDate(d.endsAt) : 'Open-ended'}</TableCell>
                <TableCell>
                  <Badge className={scheduleState(d) === 'Active' ? 'bg-green-500' : scheduleState(d) === 'Scheduled' ? 'bg-blue-500' : ''}>
                    {scheduleState(d)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <button
                    type='button'
                    className='text-sm underline underline-offset-2 hover:text-primary disabled:no-underline disabled:text-muted-foreground'
                    title='Orders using this discount'
                    disabled={!d._count?.applications}
                    onClick={() => setApplicationsFor(d)}
                  >
                    {d._count?.applications ?? '—'}
                  </button>
                </TableCell>
                <TableCell className='flex gap-1'>
                  <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(d)}><Pencil className='h-3.5 w-3.5' /></Button>
                  <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => deleteMut.mutate(d.id)}><Trash2 className='h-3.5 w-3.5 text-destructive' /></Button>
                </TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={9} className='text-center py-8 text-muted-foreground'>No automatic discounts yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null) } }}>
        <DialogContent className='max-w-lg max-h-[90vh] overflow-y-auto'>
          <DialogHeader><DialogTitle>{editing ? 'Edit Discount' : 'Add Discount'}</DialogTitle></DialogHeader>
          <div className='space-y-3 py-2'>
            <div>
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => updateForm({ title: e.target.value })} placeholder='Eid Sale — 10% off Electronics' />
              {errors.title && <p className='text-xs text-destructive mt-1'>{errors.title}</p>}
            </div>
            <div>
              <Label>Applies To</Label>
              <SearchableSelect
                options={[
                  { id: 'SITEWIDE', label: 'Entire site (all products)' },
                  { id: 'CATEGORY', label: 'Specific categories (incl. subcategories)' },
                  { id: 'PRODUCT', label: 'Specific products' },
                ]}
                value={form.scope}
                onChange={(val) => updateForm({ scope: val })}
                placeholder='Select scope...'
              />
              {errors.scope && <p className='text-xs text-destructive mt-1'>{errors.scope}</p>}
            </div>
            {form.scope === 'CATEGORY' && (
              <div>
                <Label>Categories</Label>
                <MultiSearchableSelect
                  options={categoryOptions}
                  value={form.categoryIds}
                  onChange={(v) => updateForm({ categoryIds: v })}
                  placeholder='Pick categories...'
                />
                <p className='text-xs text-muted-foreground mt-1'>Every product in the picked categories — and all their subcategories — gets this discount. Picking a parent already includes its subcategories, so there is no need to pick both.</p>
              </div>
            )}
            {form.scope === 'PRODUCT' && (
              <div className='space-y-3'>
                <div>
                  <Label>Products</Label>
                  <div className='border rounded-md p-2 focus-within:ring-2 focus-within:ring-ring'>
                    {selectedProducts.length > 0 && (
                      <div className='flex flex-wrap gap-1 mb-2'>
                        {selectedProducts.map((p) => (
                          <Badge key={p.id} variant='secondary' className='gap-1'>
                            {p.name}
                            <button type='button' onClick={() => pruneVariants(form.productIds.filter((id) => id !== p.id))}><X className='h-3 w-3' /></button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <input
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder='Search products by name or SKU...'
                      className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                    />
                  </div>
                  {productSearch.trim().length >= 2 && (
                    <div className='border rounded-md mt-1 max-h-72 overflow-y-auto'>
                      <div className='px-3 py-2 bg-muted/40 border-b text-xs text-muted-foreground'>
                        {productSearching
                          ? 'Searching…'
                          : `${(productResults ?? []).length} product${(productResults ?? []).length === 1 ? '' : 's'} found`}
                      </div>
                      {!productSearching && (productResults ?? []).length === 0 && (
                        <p className='px-3 py-4 text-sm text-muted-foreground'>No products found</p>
                      )}
                      {((productResults ?? []) as ProductRow[]).map((p) => {
                        const selected = form.productIds.includes(p.id)
                        const isVariable = p.type === 'variable' || (p.variants?.length ?? 0) > 0
                        return (
                          <div key={p.id} className='w-full px-3 py-2.5 hover:bg-accent flex items-center gap-3'>
                            {p.images && Array.isArray(p.images) && p.images[0] ? (
                              <SafeImage src={mediaUrl(p.images[0])} alt='' className='h-11 w-11 rounded-lg border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                            ) : (
                              <div className='h-11 w-11 rounded-lg border bg-muted flex items-center justify-center shrink-0'>
                                <Package className='h-5 w-5 text-muted-foreground' />
                              </div>
                            )}
                            <div className='min-w-0 flex-1'>
                              <p className='text-sm font-semibold line-clamp-2 leading-snug'>{p.name}</p>
                              <div className='flex items-center gap-1.5 mt-1 flex-wrap'>
                                {p.sku && (
                                  <span className='text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>{p.sku}</span>
                                )}
                                {isVariable && (
                                  <Badge variant='outline' className='text-[10px] h-4.5 font-normal border-primary/30 text-primary'>
                                    {p.variants?.length} options
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className='text-right shrink-0'>
                              <div className='text-sm font-bold text-primary'>৳{productPrice(p).toFixed(2)}</div>
                              <Button
                                size='sm'
                                variant='secondary'
                                className='h-7 text-xs px-2.5 mt-1'
                                disabled={selected}
                                onClick={() => {
                                  updateForm({ productIds: [...form.productIds, p.id] })
                                  setProductSearch('')
                                }}
                              >
                                {selected ? 'Selected' : '+ Select'}
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                {form.productIds.length > 0 && variantOptions.length > 0 && (
                  <div>
                    <Label>Variants (optional — leave empty for all variants)</Label>
                    <MultiSearchableSelect
                      options={variantOptions}
                      value={form.variantIds}
                      onChange={(v) => updateForm({ variantIds: v })}
                      placeholder='All variants...'
                    />
                    <p className='text-xs text-muted-foreground mt-1'>Only the picked variants of the products above get this discount.</p>
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
                  onChange={(val) => updateForm({ type: val })}
                  placeholder='Select type...'
                />
              </div>
              <div>
                <Label>Value</Label>
                <div className='relative'>
                  <Input
                    type='number'
                    value={form.value}
                    onChange={(e) => updateForm({ value: e.target.value })}
                    placeholder='e.g. 10'
                    className='pr-8'
                  />
                  <span className='absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground'>
                    {form.type === 'percentage' ? '%' : '৳'}
                  </span>
                </div>
                {errors.value && <p className='text-xs text-destructive mt-1'>{errors.value}</p>}
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <Label>Minimum Order Amount (optional)</Label>
                <Input type='number' value={form.minOrderAmount} onChange={(e) => updateForm({ minOrderAmount: e.target.value })} placeholder='Leave empty for no condition' />
                <p className='text-xs text-muted-foreground mt-1'>
                  {form.scope === 'SITEWIDE'
                    ? 'The cart subtotal must reach this amount for the discount to apply.'
                    : 'Only the subtotal of items in scope counts toward this amount — other items do not help reach it.'}
                </p>
              </div>
              <div>
                <Label>Minimum Quantity (optional)</Label>
                <Input type='number' value={form.minQuantity} onChange={(e) => updateForm({ minQuantity: e.target.value })} placeholder='Leave empty for no condition' />
                <p className='text-xs text-muted-foreground mt-1'>
                  {form.scope === 'SITEWIDE'
                    ? 'The cart must contain at least this many units for the discount to apply.'
                    : 'Total units of in-scope items only — units of other items do not count.'}
                </p>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <Label>Maximum Discount Per Order (optional)</Label>
                <Input type='number' value={form.maxDiscountAmount} onChange={(e) => updateForm({ maxDiscountAmount: e.target.value })} placeholder='Leave empty for no cap' />
                <p className='text-xs text-muted-foreground mt-1'>Caps the total discount from this rule per order, e.g. 20% up to ৳200.</p>
              </div>
              <div>
                <Label>Priority</Label>
                <Input type='number' value={form.priority} onChange={(e) => updateForm({ priority: e.target.value })} placeholder='0' />
                <p className='text-xs text-muted-foreground mt-1'>When several discounts match a line, the highest priority wins; ties go to the biggest discount, then the oldest rule.</p>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <Label>Max Total Uses (optional)</Label>
                <Input type='number' value={form.maxUses} onChange={(e) => updateForm({ maxUses: e.target.value })} placeholder='Unlimited' />
              </div>
              <div>
                <Label>Max Uses Per Customer (optional)</Label>
                <Input type='number' value={form.maxUsesPerCustomer} onChange={(e) => updateForm({ maxUsesPerCustomer: e.target.value })} placeholder='Unlimited' />
              </div>
            </div>
            <p className='text-xs text-muted-foreground -mt-1'>Leave empty for unlimited. Per-customer counts by account, or by phone for guest orders.</p>
            <div className='flex items-center gap-2'>
              <Switch checked={form.excludeSaleItems} onCheckedChange={(v) => updateForm({ excludeSaleItems: v })} />
              <div>
                <Label>Exclude sale items</Label>
                <p className='text-xs text-muted-foreground'>Items already on sale do not get this discount, and do not count toward its minimums.</p>
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <Switch checked={form.combineWithCoupon} onCheckedChange={(v) => updateForm({ combineWithCoupon: v })} />
              <div>
                <Label>Combine with coupon codes</Label>
                <p className='text-xs text-muted-foreground'>Off = this discount does not apply on orders that use a coupon code.</p>
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <Switch checked={form.firstOrderOnly} onCheckedChange={(v) => updateForm({ firstOrderOnly: v })} />
              <div>
                <Label>First orders only</Label>
                <p className='text-xs text-muted-foreground'>Only customers with no previous order get this discount.</p>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div><Label>Starts At</Label><Input type='datetime-local' value={form.startsAt} onChange={(e) => updateForm({ startsAt: e.target.value })} /></div>
              <div><Label>Ends At</Label><Input type='datetime-local' value={form.endsAt} onChange={(e) => updateForm({ endsAt: e.target.value })} /></div>
            </div>
            <p className='text-xs text-muted-foreground -mt-1'>Dates use your browser's local time. Leave start empty to start immediately. Leave end empty to keep it open-ended — you can set an end any time later.</p>
            {errors.dates && <p className='text-xs text-destructive -mt-1'>{errors.dates}</p>}
            <div className='flex items-center gap-2'>
              <Switch checked={form.isActive} onCheckedChange={(v) => updateForm({ isActive: v })} />
              <div>
                <Label>Active</Label>
                <p className='text-xs text-muted-foreground'>Off = the discount never applies, even inside its dates.</p>
              </div>
            </div>
            <p className='text-xs text-muted-foreground'>The discount applies to the price actually paid (sale price when present, otherwise regular price) including customization add-ons, but never to shipping.</p>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMut.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!applicationsFor} onOpenChange={(v) => { if (!v) setApplicationsFor(null) }}>
        <DialogContent className='max-w-lg max-h-[90vh] overflow-y-auto'>
          <DialogHeader><DialogTitle>Orders using “{applicationsFor?.title}”</DialogTitle></DialogHeader>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Order</TableHead><TableHead>Discount</TableHead><TableHead>Date</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {appRows.length ? appRows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.order?.displayId ?? '—'}</TableCell>
                  <TableCell>{fmtMoney(a.amount)}</TableCell>
                  <TableCell className='text-xs'>{fmtDate(a.createdAt)}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={3} className='text-center py-6 text-muted-foreground'>No orders yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant='outline' onClick={() => setApplicationsFor(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
