import { type ColumnDef } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTableColumnHeader } from '@/components/data-table'
import { type ProductResponse } from '../api'
import { DataTableRowActions } from './data-table-row-actions'

export const productsColumns: ColumnDef<ProductResponse>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label='Select all'
        className='translate-y-0.5'
      />
    ),
    meta: {
      className: cn('inset-s-0 z-10 rounded-tl-[inherit] max-md:sticky'),
    },
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label='Select row'
        className='translate-y-0.5'
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Name' />
    ),
    cell: ({ row }) => (
      <div className='max-w-48 truncate ps-3 font-medium'>
        {row.getValue('name')}
      </div>
    ),
    meta: {
      className: cn(
        'drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.1)] dark:drop-shadow-[0_1px_2px_rgb(255_255_255_/_0.1)]',
        'inset-s-6 ps-0.5 max-md:sticky @4xl/content:table-cell @4xl/content:drop-shadow-none'
      ),
    },
    enableHiding: false,
  },
  {
    id: 'price',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Price' />
    ),
    accessorFn: (row) => {
      const price = row.salePrice ?? row.basePrice
      return price
    },
    cell: ({ row }) => {
      const basePrice = parseFloat(String(row.original.basePrice))
      const salePrice = row.original.salePrice != null ? parseFloat(String(row.original.salePrice)) : null
      return (
        <div className='flex items-center gap-2'>
          {salePrice !== null && salePrice < basePrice ? (
            <>
              <span className='text-muted-foreground line-through text-xs'>
                ${basePrice.toFixed(2)}
              </span>
              <span className='font-medium text-green-600 dark:text-green-400'>
                ${salePrice.toFixed(2)}
              </span>
            </>
          ) : (
            <span>${basePrice.toFixed(2)}</span>
          )}
        </div>
      )
    },
  },
  {
    id: 'category',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Category' />
    ),
    accessorFn: (row) => row.category?.name ?? '—',
    cell: ({ row }) => (
      <div className='text-sm'>{row.getValue('category')}</div>
    ),
    enableSorting: false,
  },
  {
    id: 'stock',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Stock' />
    ),
    accessorFn: (row) =>
      row.variants?.reduce((sum, v) => sum + (v.stock || 0), 0) ?? 0,
    cell: ({ row }) => {
      const stock = row.getValue<number>('stock')
      return (
        <Badge variant={stock > 0 ? 'default' : 'destructive'} className='text-xs'>
          {stock}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'isActive',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Status' />
    ),
    cell: ({ row }) => {
      const isActive = row.getValue('isActive')
      return (
        <Badge
          variant='outline'
          className={cn(
            'capitalize',
            isActive
              ? 'text-green-600 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-800 dark:bg-green-950'
              : 'text-muted-foreground'
          )}
        >
          {isActive ? 'Active' : 'Draft'}
        </Badge>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
    enableSorting: false,
  },
  {
    id: 'actions',
    cell: DataTableRowActions,
  },
]
