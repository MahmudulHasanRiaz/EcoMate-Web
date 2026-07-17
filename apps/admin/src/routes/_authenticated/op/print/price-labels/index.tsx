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
  const idList = ids ? ids.split(',').filter(Boolean) : []
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
