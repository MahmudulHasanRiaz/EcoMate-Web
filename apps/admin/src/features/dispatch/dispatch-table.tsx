import { useState } from 'react'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Trash2, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DataTablePagination, DataTableToolbar } from '@/components/data-table'
import { type DispatchResponse } from './api'
import { DISPATCH_STATUSES, COURIER_OPTIONS } from './data/data'

type DispatchTableProps = {
  data: DispatchResponse[]
  total: number
  pagination: PaginationState
  onPaginationChange: (pagination: PaginationState) => void
  isLoading?: boolean
  onDelete: (id: string) => void
}

export function DispatchTable({
  data,
  total,
  pagination,
  onPaginationChange,
  isLoading,
  onDelete,
}: DispatchTableProps) {
  const [rowSelection, setRowSelection] = useState({})
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const columns: ColumnDef<DispatchResponse>[] = [
    {
      accessorKey: 'id',
      header: 'ID',
      cell: ({ row }) => (
        <div className='w-24 font-mono text-sm'>
          {row.original.id.slice(0, 8)}...
        </div>
      ),
      meta: { className: 'w-28', tdClassName: 'ps-4' },
      enableSorting: false,
    },
    {
      accessorKey: 'orderId',
      header: 'Order ID',
      cell: ({ row }) => (
        <div className='font-mono text-sm'>
          {row.original.order?.displayId || row.original.orderId.slice(0, 8)}
        </div>
      ),
      meta: { className: 'w-28', tdClassName: 'ps-4' },
    },
    {
      accessorKey: 'courier',
      header: 'Courier',
      cell: ({ row }) => (
        <div className='capitalize'>{row.getValue('courier')}</div>
      ),
      meta: { className: 'w-24', tdClassName: 'ps-4' },
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: 'consignmentId',
      header: 'Consignment ID',
      cell: ({ row }) => (
        <div className='font-mono text-sm'>{row.getValue('consignmentId')}</div>
      ),
      meta: { tdClassName: 'ps-4' },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = DISPATCH_STATUSES.find(
          (s) => s.value === row.getValue('status'),
        )
        return (
          <Badge
            variant='outline'
            className={cn(
              'capitalize',
              status?.color
                ? `${status.color} text-white`
                : 'bg-gray-500 text-white',
            )}
          >
            {status?.label || row.getValue('status')}
          </Badge>
        )
      },
      meta: { tdClassName: 'ps-4' },
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created At',
      cell: ({ row }) => (
        <div className='text-sm text-muted-foreground'>
          {new Date(row.getValue('createdAt')).toLocaleDateString()}
        </div>
      ),
      meta: { className: 'w-32', tdClassName: 'ps-4' },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const dispatch = row.original
        return (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                className='flex h-8 w-8 p-0 data-[state=open]:bg-muted'
              >
                <DotsHorizontalIcon className='h-4 w-4' />
                <span className='sr-only'>Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-40'>
              <DropdownMenuItem>
                <Eye size={16} className='me-2' />
                View
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onDelete(dispatch.id)}>
                Delete
                <DropdownMenuShortcut>
                  <Trash2 size={16} />
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const statusFilterOpts = DISPATCH_STATUSES.map((s) => ({
    label: s.label,
    value: s.value,
  }))

  const courierFilterOpts = COURIER_OPTIONS.map((c) => ({
    label: c.label,
    value: c.value,
  }))

  const pageCount = Math.ceil(total / pagination.pageSize)

  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: { sorting, columnVisibility, rowSelection, pagination },
    manualPagination: true,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: (updater) => {
      if (typeof updater === 'function') {
        onPaginationChange(updater(pagination))
      } else {
        onPaginationChange(updater)
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <DataTableToolbar
        table={table}
        searchPlaceholder='Search by ID or consignment...'
        filters={[
          { columnId: 'status', title: 'Status', options: statusFilterOpts },
          { columnId: 'courier', title: 'Courier', options: courierFilterOpts },
        ]}
      />
      <div className='overflow-hidden rounded-md border'>
        <Table className='min-w-xl'>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cn(header.column.columnDef.meta?.className)}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-24 text-center'
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(cell.column.columnDef.meta?.tdClassName)}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-24 text-center'
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination
        table={table}
        className='mt-auto'
        totalCount={total}
      />
    </div>
  )
}
