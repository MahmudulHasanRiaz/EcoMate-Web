# Price Label Sticker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bulk price label sticker printing with SKU barcodes from product list, with configurable dimensions in admin settings.

**Architecture:** Extends existing print infrastructure (print layout, `react-barcode`, bulk action pattern). Settings stored in `SystemSetting` KV store. Products fetched via existing `GET /products?ids=...` which already includes variants with attribute values.

**Tech Stack:** react-barcode, shadcn/ui, TanStack Router, TanStack Query, SystemSetting KV store

---

## File Structure

### Modified Files
- `apps/admin/src/features/products/index.tsx` — Add "Price Label" bulk action button
- `apps/admin/src/features/settings/index.tsx` — Add "Price Label" to System sidebar nav

### Created Files
- `apps/admin/src/features/settings/price-label/price-label-settings.tsx` — Settings page (width × height)
- `apps/admin/src/routes/_authenticated/mon/settings/price-label/index.tsx` — Settings route
- `apps/admin/src/features/print/price-label-template.tsx` — Single sticker component
- `apps/admin/src/features/print/components/price-label-options-modal.tsx` — Print options modal
- `apps/admin/src/features/print/hooks.ts` — Data fetching for price label print
- `apps/admin/src/routes/_authenticated/op/print/price-labels/index.tsx` — Print route page

---

### Task 1: Price Label Settings Page + Route

**Files:**
- Create: `apps/admin/src/features/settings/price-label/price-label-settings.tsx`
- Create: `apps/admin/src/routes/_authenticated/mon/settings/price-label/index.tsx`
- Modify: `apps/admin/src/features/settings/index.tsx` (add sidebar nav entry)

- [ ] **Step 1: Create settings component**

```tsx
// apps/admin/src/features/settings/price-label/price-label-settings.tsx
import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from '../storage-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Loader2, Printer, Save } from 'lucide-react'

const DEFAULT_WIDTH = 50
const DEFAULT_HEIGHT = 30
const MIN_WIDTH = 20
const MIN_HEIGHT = 15
const MAX_WIDTH = 100
const MAX_HEIGHT = 75

export function PriceLabelSettings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)

  useEffect(() => {
    if (settings?.price_label) {
      try {
        const parsed = JSON.parse(settings.price_label)
        if (parsed.width) setWidth(parsed.width)
        if (parsed.height) setHeight(parsed.height)
      } catch {}
    }
  }, [settings])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => systemSettingsApi.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  })

  const handleSave = () => {
    const value = JSON.stringify({ width, height })
    setMut.mutateAsync({ key: 'price_label', value })
      .then(() => toast.success('Price label settings saved'))
      .catch(() => toast.error('Failed to save settings'))
  }

  if (isLoading) return <div className='flex items-center justify-center min-h-[400px]'><Loader2 className='animate-spin h-8 w-8 text-primary' /></div>

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Price Label</h2>
        <p className='text-muted-foreground'>Configure thermal price label sticker dimensions.</p>
      </div>
      <Separator className='my-6' />
      <Card>
        <CardHeader>
          <div className='flex items-center gap-2 mb-1'>
            <Printer className='h-5 w-5 text-primary' />
            <CardTitle>Sticker Dimensions</CardTitle>
          </div>
          <CardDescription>Set the width and height for price label stickers (thermal printer).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid gap-6 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='pl-width'>Width (mm)</Label>
              <Input
                id='pl-width'
                type='number'
                min={MIN_WIDTH}
                max={MAX_WIDTH}
                value={width}
                onChange={e => setWidth(Number(e.target.value))}
              />
              <p className='text-[11px] text-muted-foreground'>Min {MIN_WIDTH}mm, Max {MAX_WIDTH}mm</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='pl-height'>Height (mm)</Label>
              <Input
                id='pl-height'
                type='number'
                min={MIN_HEIGHT}
                max={MAX_HEIGHT}
                value={height}
                onChange={e => setHeight(Number(e.target.value))}
              />
              <p className='text-[11px] text-muted-foreground'>Min {MIN_HEIGHT}mm, Max {MAX_HEIGHT}mm</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className='flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20'>
        <div className='text-sm text-muted-foreground'>Default: {DEFAULT_WIDTH}mm x {DEFAULT_HEIGHT}mm</div>
        <Button onClick={handleSave} size='lg' className='px-8' disabled={setMut.isPending}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create settings route**

```tsx
// apps/admin/src/routes/_authenticated/mon/settings/price-label/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { PriceLabelSettings } from '@/features/settings/price-label/price-label-settings'
export const Route = createFileRoute('/_authenticated/mon/settings/price-label/')({ component: PriceLabelSettings })
```

- [ ] **Step 3: Modify settings sidebar**

Edit `apps/admin/src/features/settings/index.tsx` — add to "System" nav group:

```tsx
// After "License Settings" entry, add:
{ title: 'Price Label', href: '/mon/settings/price-label', icon: <Printer size={18} /> },
```

Also import `Printer` from lucide-react at the top.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit` in `apps/admin/`

---

### Task 2: Price Label Template Component

**Files:**
- Create: `apps/admin/src/features/print/price-label-template.tsx`

- [ ] **Step 1: Create the sticker component**

```tsx
// apps/admin/src/features/print/price-label-template.tsx
import Barcode from 'react-barcode'

type PriceMode = 'base' | 'sale' | 'smart' | 'both'

type Props = {
  sku: string
  basePrice: number | null
  salePrice: number | null
  priceMode: PriceMode
  attributes?: { name: string; value: string }[]
  widthMm: number
  heightMm: number
}

function fmtPrice(v: number | null | undefined): string {
  return v != null ? `৳${Number(v).toFixed(0)}` : ''
}

function getBarcodeWidth(sku: string, stickerWidthMm: number): number {
  const len = sku.length
  // Scale: longer SKU = narrower bars to fit
  // stickerWidthMm ~50mm. At 3.779px/mm, 50mm ≈ 189px usable.
  if (len <= 8) return 1.8
  if (len <= 12) return 1.4
  if (len <= 16) return 1.1
  return 0.8
}

export function PriceLabelTemplate({ sku, basePrice, salePrice, priceMode, attributes, widthMm, heightMm }: Props) {
  const barcodeWidth = getBarcodeWidth(sku, widthMm)
  const isNarrow = widthMm < 40
  const fontSize = isNarrow ? 7 : 8

  const renderPrice = () => {
    switch (priceMode) {
      case 'base':
        return <div className='font-bold' style={{ fontSize }}>{fmtPrice(basePrice)}</div>
      case 'sale':
        return <div className='font-bold' style={{ fontSize }}>{fmtPrice(salePrice)}</div>
      case 'smart':
        return <div className='font-bold' style={{ fontSize }}>{fmtPrice(salePrice ?? basePrice)}</div>
      case 'both':
        return (
          <div style={{ fontSize }}>
            {salePrice != null ? (
              <>
                <span className='line-through text-muted-foreground' style={{ fontSize: fontSize - 1 }}>{fmtPrice(basePrice)}</span>
                {' '}
                <span className='font-bold' style={{ fontSize }}>{fmtPrice(salePrice)}</span>
              </>
            ) : (
              <span className='font-bold'>{fmtPrice(basePrice)}</span>
            )}
          </div>
        )
    }
  }

  return (
    <div className='price-label-sticker'>
      <div className='pl-barcode'>
        <Barcode
          value={sku}
          width={barcodeWidth}
          height={isNarrow ? 18 : 24}
          fontSize={isNarrow ? 6 : 7}
          margin={0}
          background='#fff'
          lineColor='#000'
        />
      </div>
      <div className='pl-price'>{renderPrice()}</div>
      {attributes && attributes.length > 0 && (
        <div className='pl-attrs' style={{ fontSize: fontSize - 1 }}>
          {attributes.map((a, i) => (
            <span key={i} className='text-muted-foreground'>
              {i > 0 ? ', ' : ''}{a.name}: {a.value}
            </span>
          ))}
        </div>
      )}
      <style>{`
        @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
        .price-label-sticker {
          width: ${widthMm}mm; height: ${heightMm}mm;
          padding: 1.5mm 2mm;
          font-family: 'Inter', sans-serif;
          color: #000;
          box-sizing: border-box;
          background: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1mm;
          overflow: hidden;
        }
        .price-label-sticker .pl-barcode {
          display: flex;
          justify-content: center;
        }
        .price-label-sticker .pl-barcode svg {
          max-width: 100%;
          height: auto;
        }
        .price-label-sticker .pl-price {
          text-align: center;
          line-height: 1.2;
        }
        .price-label-sticker .pl-price .line-through {
          text-decoration: line-through;
          opacity: 0.6;
        }
        .price-label-sticker .pl-attrs {
          text-align: center;
          line-height: 1.1;
          opacity: 0.7;
        }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit` in `apps/admin/`

---

### Task 3: Price Label Options Modal

**Files:**
- Create: `apps/admin/src/features/print/components/price-label-options-modal.tsx`

- [ ] **Step 1: Create modal component**

```tsx
// apps/admin/src/features/print/components/price-label-options-modal.tsx
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Printer } from 'lucide-react'

export type PrintScope = 'parent' | 'variants' | 'all'
export type PriceMode = 'base' | 'sale' | 'smart' | 'both'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: string[]
}

export function PriceLabelOptionsModal({ open, onOpenChange, selectedIds }: Props) {
  const navigate = useNavigate()
  const [scope, setScope] = useState<PrintScope>('all')
  const [priceMode, setPriceMode] = useState<PriceMode>('smart')
  const [showAttrs, setShowAttrs] = useState(true)

  const handlePrint = () => {
    onOpenChange(false)
    navigate({
      to: '/op/print/price-labels',
      search: {
        ids: selectedIds.join(','),
        scope,
        price: priceMode,
        showAttrs: showAttrs ? 'true' : 'false',
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Print Price Labels</DialogTitle>
          <DialogDescription>
            {selectedIds.length} product(s) selected. Choose what to print.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-5 py-3'>
          <div className='space-y-3'>
            <Label>Scope</Label>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as PrintScope)}>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='parent' id='scope-parent' />
                <Label htmlFor='scope-parent' className='font-normal'>Parent only</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='variants' id='scope-variants' />
                <Label htmlFor='scope-variants' className='font-normal'>Variants only</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='all' id='scope-all' />
                <Label htmlFor='scope-all' className='font-normal'>All (parent + variants)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className='space-y-3'>
            <Label>Price</Label>
            <RadioGroup value={priceMode} onValueChange={(v) => setPriceMode(v as PriceMode)}>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='base' id='price-base' />
                <Label htmlFor='price-base' className='font-normal'>Base Price</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='sale' id='price-sale' />
                <Label htmlFor='price-sale' className='font-normal'>Sale Price</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='smart' id='price-smart' />
                <Label htmlFor='price-smart' className='font-normal'>Smart (sale if exists, else base)</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='both' id='price-both' />
                <Label htmlFor='price-both' className='font-normal'>Both (base crossed + sale)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className='flex items-center gap-2'>
            <Switch id='show-attrs' checked={showAttrs} onCheckedChange={setShowAttrs} />
            <Label htmlFor='show-attrs' className='font-normal'>Show variant attributes</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handlePrint}>
            <Printer className='h-4 w-4 mr-1.5' />
            Print ({selectedIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit` in `apps/admin/`

---

### Task 4: Price Label Print Route

**Files:**
- Create: `apps/admin/src/features/print/hooks.ts`
- Create: `apps/admin/src/routes/_authenticated/op/print/price-labels/index.tsx`

- [ ] **Step 1: Create data fetching hook**

```tsx
// apps/admin/src/features/print/hooks.ts
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

type VariantAttr = {
  attributeValue: {
    id: string
    value: string
    attribute: { id: string; name: string }
  }
}

export type ProductForLabel = {
  id: string
  sku: string | null
  type: 'simple' | 'variable'
  basePrice: string
  salePrice: string | null
  variants: Array<{
    id: string
    sku: string
    price: string | null
    salePrice: string | null
    attributeValues: VariantAttr[]
  }>
}

export type PriceLabelSettings = {
  width: number
  height: number
}

export function usePriceLabelProducts(ids: string[]) {
  return useQuery({
    queryKey: ['price-label-products', ids],
    queryFn: async () => {
      const res = await apiClient.get('/products', {
        params: { ids: ids.join(','), perPage: 500 },
      })
      return (res.data?.data || []) as ProductForLabel[]
    },
    enabled: ids.length > 0,
  })
}

export function usePriceLabelSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: () => apiClient.get('/system-settings').then(r => r.data as Record<string, string>),
    select: (data): PriceLabelSettings => {
      try {
        const parsed = JSON.parse(data.price_label || '{}')
        return {
          width: parsed.width || 50,
          height: parsed.height || 30,
        }
      } catch {
        return { width: 50, height: 30 }
      }
    },
  })
}

export function getVariantAttributes(v: ProductForLabel['variants'][number]): { name: string; value: string }[] {
  return v.attributeValues
    .filter(av => av?.attributeValue)
    .map(av => ({
      name: av.attributeValue.attribute.name,
      value: av.attributeValue.value,
    }))
}
```

- [ ] **Step 2: Create print route page**

```tsx
// apps/admin/src/routes/_authenticated/op/print/price-labels/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { usePriceLabelProducts, usePriceLabelSettings, getVariantAttributes } from '@/features/print/hooks'
import { PriceLabelTemplate } from '@/features/print/price-label-template'
import { Button } from '@/components/ui/button'
import { Printer, Loader2 } from 'lucide-react'
import type { PrintScope, PriceMode } from '@/features/print/components/price-label-options-modal'

type SearchParams = {
  ids: string
  scope: PrintScope
  price: PriceMode
  showAttrs: string
}

export const Route = createFileRoute('/_authenticated/op/print/price-labels/')({
  component: PriceLabelsPrint,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    ids: (search.ids as string) || '',
    scope: (search.scope as PrintScope) || 'all',
    price: (search.price as PriceMode) || 'smart',
    showAttrs: (search.showAttrs as string) || 'true',
  }),
})

function PriceLabelsPrint() {
  const { ids, scope, price, showAttrs } = Route.useSearch()
  const idList = ids ? ids.split(',') : []
  const { data: products, isLoading } = usePriceLabelProducts(idList)
  const { data: labelSettings } = usePriceLabelSettings()
  const dims = labelSettings ?? { width: 50, height: 30 }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-screen'>
        <Loader2 className='animate-spin h-8 w-8' />
      </div>
    )
  }

  const stickers: Array<{ sku: string; basePrice: number | null; salePrice: number | null; attrs: { name: string; value: string }[] }> = []

  for (const p of products || []) {
    const printParent = scope === 'parent' || scope === 'all'
    const printVariants = scope === 'variants' || scope === 'all'
    const showA = showAttrs === 'true'

    if (printParent && p.sku) {
      stickers.push({
        sku: p.sku,
        basePrice: Number(p.basePrice),
        salePrice: p.salePrice ? Number(p.salePrice) : null,
        attrs: [],
      })
    }

    if (printVariants && p.variants?.length > 0) {
      for (const v of p.variants) {
        if (!v.sku) continue
        stickers.push({
          sku: v.sku,
          basePrice: v.price ? Number(v.price) : Number(p.basePrice),
          salePrice: v.salePrice ? Number(v.salePrice) : (p.salePrice ? Number(p.salePrice) : null),
          attrs: showA ? getVariantAttributes(v) : [],
        })
      }
    }
  }

  const skipped = (products || []).reduce((count, p) => {
    const hasParent = scope === 'parent' || scope === 'all'
    const hasVariants = scope === 'variants' || scope === 'all'
    let c = 0
    if (hasParent && !p.sku) c++
    if (hasVariants) c += p.variants?.filter(v => !v.sku).length || 0
    return count + c
  }, 0)

  return (
    <div>
      <div className='no-print flex items-center justify-between p-4 bg-muted/30 border-b sticky top-0 z-10'>
        <div>
          <h1 className='text-lg font-semibold'>Price Labels</h1>
          <p className='text-sm text-muted-foreground'>
            {stickers.length} sticker(s)
            {skipped > 0 && ` (${skipped} skipped - no SKU)`}
          </p>
        </div>
        <Button onClick={() => window.print()}>
          <Printer className='h-4 w-4 mr-1.5' />
          Print All ({stickers.length})
        </Button>
      </div>

      <div className='p-4 print:p-0'>
        {stickers.map((s, i) => (
          <PriceLabelTemplate
            key={`${s.sku}-${i}`}
            sku={s.sku}
            basePrice={s.basePrice}
            salePrice={s.salePrice}
            priceMode={price}
            attributes={s.attrs}
            widthMm={dims.width}
            heightMm={dims.height}
          />
        ))}
        {stickers.length === 0 && (
          <div className='flex items-center justify-center h-40 text-muted-foreground'>
            No printable stickers. Products may be missing SKUs.
          </div>
        )}
      </div>

      <style>{`
        @media print {
          body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .price-label-sticker { page-break-after: always; }
          .price-label-sticker:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit` in `apps/admin/`

---

### Task 5: Bulk Action Button in Products Page

**Files:**
- Modify: `apps/admin/src/features/products/index.tsx`

- [ ] **Step 1: Add state and modal import**

At top of `apps/admin/src/features/products/index.tsx`, add import:

```tsx
import { Printer } from 'lucide-react'
import { PriceLabelOptionsModal } from '@/features/print/components/price-label-options-modal'
```

Add state near other state declarations (around line 30):

```tsx
const [priceLabelModalOpen, setPriceLabelModalOpen] = useState(false)
```

- [ ] **Step 2: Add "Price Label" button in bulk action bar**

Inside the bulk action bar div (after the Deactivate button, around line 234), add:

```tsx
<Button
  variant='outline' size='sm'
  onClick={() => setPriceLabelModalOpen(true)}
>
  <Printer className='h-4 w-4 mr-1.5' />
  Price Label
</Button>
```

- [ ] **Step 3: Add modal component**

Before the closing `</>` of the return (before the `</Main>`), add:

```tsx
<PriceLabelOptionsModal
  open={priceLabelModalOpen}
  onOpenChange={setPriceLabelModalOpen}
  selectedIds={selectedIds}
/>
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit` in `apps/admin/`

---

### Task 6: Full Integration Check

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit` in `apps/admin/`
Expected: No errors

- [ ] **Step 2: Run backend build**

Run: `npx nest build` in `apps/backend/`
Expected: No errors
