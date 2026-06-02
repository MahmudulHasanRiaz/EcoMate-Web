import { type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pencil, Trash2, Gift } from 'lucide-react'
import { appUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { type ComboResponse } from '../api'

const imgUrl = appUrl

export function combosColumns(
  onEdit: (row: ComboResponse) => void,
  onDelete: (row: ComboResponse) => void,
): ColumnDef<ComboResponse>[] {
  return [
    {
      id: 'image',
      header: '',
      cell: ({ row }) => {
        const img = row.original.image || (Array.isArray(row.original.images) ? row.original.images[0] : null)
        return img
          ? <SafeImage src={imgUrl(img)} alt='' className='w-9 h-9 rounded border object-cover' />
          : <div className='w-9 h-9 rounded border bg-muted flex items-center justify-center'><Gift className='h-4 w-4 text-muted-foreground' /></div>
      },
      enableSorting: false,
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div>
          <p className='font-medium text-sm'>{row.getValue('name')}</p>
          <p className='text-xs text-muted-foreground'>Slug: {row.original.slug}</p>
        </div>
      ),
    },
    {
      id: 'items_count',
      header: 'Items',
      accessorFn: (row) => row.items.length,
      cell: ({ getValue }) => <Badge variant='outline'>{getValue<number>()} items</Badge>,
    },
    {
      id: 'price',
      header: 'Price',
      accessorFn: (row) => parseFloat(String(row.basePrice)),
      cell: ({ row }) => {
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
      accessorFn: (row) => row.manageStock ? row.stock : null,
      cell: ({ getValue }) => {
        const s = getValue<number | null>()
        if (s === null) return <span className='text-sm text-muted-foreground'>Unmanaged</span>
        return <Badge variant={s <= 0 ? 'destructive' : 'outline'}>{s}</Badge>
      },
    },
    {
      id: 'category',
      header: 'Category',
      accessorFn: (row) => row.category?.name || '—',
      cell: ({ getValue }) => <span className='text-sm text-muted-foreground'>{getValue<string>()}</span>,
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ getValue }) => getValue() ? <Badge className='bg-green-500 text-xs'>Active</Badge> : <Badge variant='secondary' className='text-xs'>Draft</Badge>,
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
