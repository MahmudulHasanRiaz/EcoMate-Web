import { Link } from '@tanstack/react-router'
import { AlertTriangle, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PhysicalStockConfirmError } from '../physical-stock-confirm-error'

/**
 * Confirm-gate physical-stock help (2026-11-24 inventory fix round,
 * Issue 4): when confirming fails because a line has no (or not enough)
 * physical stock, the status dialog keeps the reason on screen AND gives
 * staff a direct path to fix it — instead of the old bare error toast.
 *
 * - Simple product (matched order line, no variant): deep-link to the
 *   product's inventory detail page, where Adjust opens the physical
 *   adjust dialog for that product — the write path creates the first
 *   physical row. Purchase order is the secondary path.
 * - Variant line, or a product the backend names but no order line
 *   matches (e.g. a combo component): the inventory detail page has no
 *   Adjust button for variable products, so the purchase path is primary
 *   — receiving a purchase creates the physical record — with the
 *   inventory page as a view-only secondary link.
 * - Nothing matched: purchase path only, with the reason still shown.
 *
 * The gate logic itself is untouched — this only renders after the
 * backend has already refused the confirm.
 */
export function PhysicalStockConfirmHelp({
  error,
}: {
  error: PhysicalStockConfirmError | null
}) {
  if (!error) return null

  const productId = error.productId
  const productName = error.productName
  const isVariantLine = !!error.variantId

  return (
    <div
      data-testid='physical-stock-confirm-help'
      className='rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10'
    >
      <p className='flex items-start gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200'>
        <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
        Cannot confirm yet — add physical stock first
      </p>
      <p className='mt-1 text-xs text-amber-800 dark:text-amber-200'>
        {error.message}
      </p>

      {productId && !isVariantLine ? (
        <>
          <p className='mt-2 text-xs text-amber-800 dark:text-amber-200'>
            Add physical stock for{' '}
            {productName ? `“${productName}”` : 'this product'} first, then
            confirm again.
          </p>
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            <Button size='sm' asChild>
              <Link
                to='/op/inventory/detail'
                search={{ productId }}
              >
                <Package className='mr-1.5 h-3.5 w-3.5' /> Add physical stock
              </Link>
            </Button>
            <Link
              to='/op/purchases'
              className='text-xs font-medium text-amber-900 underline dark:text-amber-200'
            >
              or create a purchase order
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className='mt-2 text-xs text-amber-800 dark:text-amber-200'>
            {productName ? (
              <>
                Add physical stock for “{productName}” first — receiving a
                purchase creates the physical record — then confirm again.
              </>
            ) : (
              'Add physical stock first — receiving a purchase creates the physical record — then confirm again.'
            )}
          </p>
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            <Button size='sm' asChild>
              <Link to='/op/purchases'>
                <Package className='mr-1.5 h-3.5 w-3.5' /> Create purchase
                order
              </Link>
            </Button>
            {productId && (
              <Link
                to='/op/inventory/detail'
                search={{ productId }}
                className='text-xs font-medium text-amber-900 underline dark:text-amber-200'
              >
                View inventory{productName ? ` for “${productName}”` : ''}
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}
