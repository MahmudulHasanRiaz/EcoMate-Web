import { type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Pencil, Trash2, Package } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { appUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { type ProductResponse } from '../api'

const imgUrl = appUrl

export function productsColumns(
  onEdit: (row: ProductResponse) => void,
  onDelete: (row: ProductResponse) => void,
  onToggleActive?: (row: ProductResponse, active: boolean) => void,
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
          ? <SafeImage src={imgUrl(img)} alt='' className='w-9 h-9 rounded border object-cover' />
          : <div className='w-9 h-9 rounded border bg-muted flex items-center justify-center'><Package className='h-4 w-4 text-muted-foreground' /></div>
      },
      enableSorting: false,
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div>
          <p className='font-medium text-sm'>{row.getValue('name')}</p>
          {row.original.sku && <p className='text-xs text-muted-foreground'>SKU: {row.original.sku}</p>}
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      accessorFn: (row) => row.type,
      cell: ({ getValue }) => <Badge variant='outline' className='capitalize'>{getValue<string>()}</Badge>,
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
            .map(v => parseFloat(String(v.price ?? 0)))
            .filter(p => p > 0)
          if (prices.length === 0) return <span className='text-muted-foreground'>—</span>
          const min = Math.min(...prices)
          const max = Math.max(...prices)
          return (
            <span className='font-medium'>
              ৳{min.toFixed(2)}{min !== max ? ` – ৳${max.toFixed(2)}` : ''}
            </span>
          )
        }
        const bp = parseFloat(String(row.original.basePrice))
        const sp = row.original.salePrice ? parseFloat(String(row.original.salePrice)) : null
        return (
          <div>
            {sp !== null && sp < bp ? (
              <>
                <span className='line-through text-muted-foreground text-xs'>৳{bp.toFixed(2)}</span>
                <span className='text-green-600 font-medium ml-1'>৳{sp.toFixed(2)}</span>
              </>
            ) : <span className='font-medium'>৳{bp.toFixed(2)}</span>}
          </div>
        )
      },
    },
    {
      id: 'stock',
      header: 'Stock',
      accessorFn: (row) => row.type === 'variable' ? row.variants.reduce((s, v) => s + v.stock, 0) : row.stock,
      cell: ({ row, getValue }) => {
        const s = getValue<number>()
        const stockStatus = row.original.seoMeta?.stockStatus as string | undefined
        const showNumeric = row.original.type === 'variable' || row.original.manageStock
        const label = showNumeric ? `${s}` : stockStatus === 'instock' ? 'In Stock' : 'Out of Stock'
        const variant = showNumeric
          ? s <= 0 ? 'destructive' : s <= (row.original.lowStockQty || 5) ? 'default' : 'outline'
          : stockStatus === 'instock' ? 'outline' : 'destructive'
        return (
          <Badge variant={variant as 'destructive' | 'default' | 'outline'} className='text-xs'>
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
          <Switch
            checked={row.original.isActive}
            onCheckedChange={(v) => onToggleActive?.(row.original, v)}
          />
        </div>
      ),
      enableSorting: false,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className='flex gap-1 justify-end'>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => onEdit(row.original)}>
            <Pencil className='h-3.5 w-3.5' />
          </Button>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => onDelete(row.original)}>
            <Trash2 className='h-3.5 w-3.5 text-destructive' />
          </Button>
        </div>
      ),
    },
  ]
}
