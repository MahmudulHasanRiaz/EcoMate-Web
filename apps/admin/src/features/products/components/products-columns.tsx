import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Pencil, Trash2, Copy, Package, Rocket } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { mediaUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { type ProductResponse } from '../api'

const imgUrl = mediaUrl

export function productsColumns(
  onEdit: (row: ProductResponse) => void,
  onDelete: (row: ProductResponse) => void,
  onToggleActive?: (row: ProductResponse, active: boolean) => void,
  onDuplicate?: (row: ProductResponse) => void,
  imEnabled?: boolean,
  onPublish?: (row: ProductResponse) => void,
): ColumnDef<ProductResponse>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label='Select all'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label='Select row'
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
    },
    {
      id: 'image',
      header: '',
      cell: ({ row }) => {
        const img = Array.isArray(row.original.images) ? row.original.images[0] : null
        return img
          ? <SafeImage src={imgUrl(img)} alt='' className='w-9.5 h-9.5 rounded-lg border border-border/70 object-cover shadow-2xs shrink-0' thumbWidth={40} thumbHeight={40} />
          : <div className='w-9.5 h-9.5 rounded-lg border border-border/70 bg-muted/40 dark:bg-muted/20 flex items-center justify-center shadow-2xs shrink-0'><Package className='h-4 w-4 text-muted-foreground/60' /></div>
      },
      enableSorting: false,
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const p = row.original
        const hasVariants = p.type === 'variable' && p.variants?.length > 0
        const variantSkus = hasVariants ? p.variants.map(v => v.sku).filter(Boolean) : []
        return (
          <div className='space-y-0.5 max-w-[320px]'>
            <Link
              to='/op/products/$id'
              params={{ id: p.id }}
              className='font-semibold text-sm leading-snug text-foreground hover:text-primary hover:underline underline-offset-2 transition-colors cursor-pointer'
            >
              {String(row.getValue('name') ?? '')}
              {p.status === 'draft' && (
                <Badge variant='secondary' className='ml-2 text-xs'>Draft</Badge>
              )}
            </Link>
            <div className='flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground'>
              {p.sku && <span className='font-mono text-xs text-muted-foreground'>SKU: {p.sku}</span>}
              {hasVariants && (
                <span className='inline-flex items-center gap-1 font-mono text-[10.5px] rounded bg-muted/60 dark:bg-muted/30 px-1.5 py-0.2 border border-border/50 text-muted-foreground'>
                  {p.variants.length} variant{p.variants.length > 1 ? 's' : ''}
                  {variantSkus.length > 0 && (
                    <span className='text-muted-foreground/70 truncate max-w-[140px]' title={variantSkus.join(', ')}>
                      ({variantSkus.slice(0, 2).join(', ')}{variantSkus.length > 2 ? '…' : ''})
                    </span>
                  )}
                </span>
              )}
              {p.category?.name && (
                <span className='text-[11px] text-muted-foreground/60'>• {p.category.name}</span>
              )}
            </div>
          </div>
        )
      },
    },
    {
      id: 'type',
      header: 'Type',
      accessorFn: (row) => row.type,
      cell: ({ getValue }) => <Badge variant='outline' className='capitalize text-xs rounded-md border-border/70 shadow-2xs font-medium bg-muted/20'>{getValue<string>()}</Badge>,
    },
    {
      id: 'price',
      header: 'Price',
      accessorFn: (row) => row.type === 'variable'
        ? 0
        : parseFloat(String(row.basePrice)),
      cell: ({ row }) => {
        if (row.original.type === 'variable') {
          const prices = row.original.variants
            .map(v => parseFloat(String(v.salePrice ?? v.price ?? 0)))
            .filter(p => p >= 0)
          if (prices.length === 0) return <span className='text-muted-foreground'>—</span>
          const min = Math.min(...prices)
          const max = Math.max(...prices)
          return (
            <span className='font-mono font-semibold text-xs text-foreground'>
              ৳{min.toFixed(2)}{min !== max ? ` – ৳${max.toFixed(2)}` : ''}
            </span>
          )
        }
        const bp = parseFloat(String(row.original.basePrice))
        const sp = row.original.salePrice ? parseFloat(String(row.original.salePrice)) : null
        return (
          <div className='font-mono text-xs'>
            {sp !== null && sp < bp ? (
              <>
                <span className='line-through text-muted-foreground/70 text-[11px] mr-1'>৳{bp.toFixed(2)}</span>
                <span className='text-emerald-600 dark:text-emerald-400 font-bold'>৳{sp.toFixed(2)}</span>
              </>
            ) : <span className='font-semibold text-foreground'>৳{bp.toFixed(2)}</span>}
          </div>
        )
      },
    },
    {
      id: 'stock',
      header: 'Stock',
      accessorFn: (row) => row.type === 'variable' ? row.variants.reduce((s, v) => s + v.managedStockQuantity, 0) : row.managedStockQuantity,
      cell: ({ row, getValue }) => {
        if (imEnabled && row.original.availabilityMode === 'INVENTORY_CONTROLLED') {
          return <Badge variant="secondary" className="text-xs rounded-md font-medium">PI Controlled</Badge>
        }
        const s = getValue<number>()
        const stockStatus = row.original.seoMeta?.stockStatus as string | undefined
        const showNumeric = row.original.type === 'variable' || row.original.manageStock
        const label = showNumeric ? `${s}` : stockStatus === 'instock' ? 'In Stock' : 'Out of Stock'
        const variant = showNumeric
          ? s <= 0 ? 'destructive' : s <= (row.original.lowStockQty || 5) ? 'default' : 'outline'
          : stockStatus === 'instock' ? 'outline' : 'destructive'
        return (
          <Badge
            variant={variant as 'destructive' | 'default' | 'outline'}
            className={`text-xs rounded-md font-semibold font-mono ${
              variant === 'outline' ? 'border-border/70 bg-muted/20 text-foreground' : ''
            }`}
          >
            {label}
          </Badge>
        )
      },
    },
    {
      id: 'active',
      header: 'Active',
      cell: ({ row }) => (
        <div className='flex justify-center'>
          {row.original.status === 'draft'
            ? <Badge variant='outline' className='text-xs text-muted-foreground'>—</Badge>
            : (
              <Switch
                checked={row.original.isActive}
                onCheckedChange={(v) => onToggleActive?.(row.original, v)}
              />
            )}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className='flex gap-1 justify-end items-center'>
          <Button variant='ghost' size='icon' className='h-8 w-8 rounded-lg hover:bg-muted/60 dark:hover:bg-muted/30' onClick={() => onEdit(row.original)} title='Edit product'>
            <Pencil className='h-3.5 w-3.5 text-muted-foreground hover:text-foreground' />
          </Button>
          {row.original.status === 'draft'
            ? onPublish && (
              <Button variant='ghost' size='sm' className='h-8 text-xs rounded-lg text-primary hover:bg-primary/10' onClick={() => onPublish(row.original)} title='Publish draft'>
                <Rocket className='h-3.5 w-3.5 mr-1 text-primary' /> Publish
              </Button>
            )
            : onDuplicate && (
              <Button variant='ghost' size='icon' className='h-8 w-8 rounded-lg hover:bg-muted/60 dark:hover:bg-muted/30' onClick={() => onDuplicate(row.original)} title='Duplicate product'>
                <Copy className='h-3.5 w-3.5 text-muted-foreground hover:text-foreground' />
              </Button>
            )}
          <Button variant='ghost' size='icon' className='h-8 w-8 rounded-lg hover:bg-destructive/10 text-destructive' onClick={() => onDelete(row.original)} title='Delete product'>
            <Trash2 className='h-3.5 w-3.5' />
          </Button>
        </div>
      ),
    },
  ]
}
