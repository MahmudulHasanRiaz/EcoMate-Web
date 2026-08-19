import { useState } from 'react'
import { DotsHorizontalIcon, Cross2Icon, CheckIcon } from '@radix-ui/react-icons'
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Trash2, Eye, ExternalLink, RefreshCw, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DataTablePagination } from '@/components/data-table'
import { DataTableBulkActions } from '@/components/data-table/bulk-actions'
import { DataTableViewOptions } from '@/components/data-table/view-options'
import { type DispatchResponse } from './api'
import { DISPATCH_STATUSES, ALL_COURIERS, getCourierColor } from './data/data'

type DispatchTableProps = {
  data: DispatchResponse[]
  total: number
  pagination: PaginationState
  onPaginationChange: (pagination: PaginationState) => void
  search: string
  onSearchChange: (search: string) => void
  statusFilter: string
  onStatusFilterChange: (value: string) => void
  courierFilter: string
  onCourierFilterChange: (value: string) => void
  statusCounts?: Record<string, number>
  courierCounts?: Record<string, number>
  activeFilterCount: number
  onResetFilters: () => void
  isLoading?: boolean
  isSyncing?: boolean
  onDelete: (id: string) => void
  onSyncSelected: (ids: string[]) => void
}

function ServerFilterDropdown({
  title,
  value,
  onValueChange,
  options,
  counts,
}: {
  title: string
  value: string
  onValueChange: (value: string) => void
  options: { label: string; value: string }[]
  counts?: Record<string, number>
}) {
  const displayLabel = value
    ? options.find((o) => o.value === value)?.label || value
    : title
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className={cn('h-8 border-dashed gap-1', value && 'border-solid')}
        >
          {displayLabel}
          {value ? (
            <span
              role='button'
              aria-label={`Clear ${title} filter`}
              onClick={(e) => {
                e.stopPropagation()
                onValueChange('')
              }}
              className='hover:text-foreground'
            >
              <Cross2Icon className='h-3.5 w-3.5' />
            </span>
          ) : (
            <ChevronDown size={14} />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-52 max-h-80 overflow-auto'>
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onValueChange(option.value)}
            className='justify-between'
          >
            <span className='flex min-w-0 items-center'>
              {value === option.value && (
                <CheckIcon className='me-1 h-4 w-4 shrink-0' />
              )}
              <span
                className={cn(
                  'truncate',
                  value !== option.value && 'ms-5',
                )}
              >
                {option.label}
              </span>
            </span>
            {counts ? (
              <span className='ms-3 shrink-0 text-xs tabular-nums text-muted-foreground'>
                {counts[option.value] ?? 0}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DispatchTable({
  data,
  total,
  pagination,
  onPaginationChange,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  courierFilter,
  onCourierFilterChange,
  statusCounts,
  courierCounts,
  activeFilterCount,
  onResetFilters,
  isLoading,
  isSyncing,
  onDelete,
  onSyncSelected,
}: DispatchTableProps) {
  const [rowSelection, setRowSelection] = useState({})
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const columns: ColumnDef<DispatchResponse>[] = [
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
      meta: { className: 'w-12', tdClassName: 'ps-4' },
    },
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
      cell: ({ row }) => {
        const val = row.getValue('courier') as string
        const color = getCourierColor(val)
        return (
          <Badge
            variant='outline'
            className='capitalize border-0 text-white font-medium'
            style={{ backgroundColor: color || '#6b7280' }}
          >
            {val}
          </Badge>
        )
      },
      meta: { className: 'w-24', tdClassName: 'ps-4' },
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
      id: 'tracking',
      header: 'Tracking',
      cell: ({ row }) => {
        const url = row.original.trackingUrl
        return url ? (
          <Button variant='link' size='sm' className='h-6 px-0 text-xs gap-1' onClick={() => window.open(url, '_blank')}>
            Track <ExternalLink className='h-3 w-3' />
          </Button>
        ) : (
          <span className='text-xs text-muted-foreground'>—</span>
        )
      },
      meta: { className: 'w-20', tdClassName: 'ps-4' },
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
    },
    {
      id: 'courierStatus',
      header: 'Courier Status',
      cell: ({ row }) => {
        const dispatch = row.original
        const cs =
          dispatch.courierStatus ?? dispatch.order?.courierStatus ?? null
        if (!cs) {
          return <span className='text-xs text-muted-foreground'>—</span>
        }
        const syncedAt = dispatch.lastSyncedAt
          ? new Date(dispatch.lastSyncedAt).toLocaleString()
          : null
        return (
          <Badge
            variant='secondary'
            className='font-mono text-xs max-w-[160px] truncate'
            title={
              syncedAt
                ? `Courier status as of ${syncedAt}${
                    dispatch.courierStatusAt
                      ? ` (event ${new Date(
                          dispatch.courierStatusAt,
                        ).toLocaleString()})`
                      : ''
                  }`
                : undefined
            }
          >
            {cs}
          </Badge>
        )
      },
      meta: { className: 'w-32', tdClassName: 'ps-4' },
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
        const role = useAuthStore((s) => s.auth.user?.role)
        const canDelete = role === 'superadmin' || role === 'admin'
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
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onDelete(dispatch.id)}>
                    Delete
                    <DropdownMenuShortcut>
                      <Trash2 size={16} />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </>
              )}
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

  const courierFilterOpts = ALL_COURIERS.map((c) => ({
    label: c.label,
    value: c.value,
  }))

  const pageCount = Math.ceil(total / pagination.pageSize)

  const table = useReactTable({
    data,
    columns,
    pageCount,
    getRowId: (row) => row.id,
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
  })

  return (
    <div
      className={cn(
        'max-sm:has-[div[role="toolbar"]]:mb-16',
        'flex flex-1 flex-col gap-4'
      )}
    >
      <div className='flex items-center justify-between'>
        <div className='flex flex-1 flex-col-reverse items-start gap-y-2 sm:flex-row sm:items-center sm:space-x-2'>
          <Input
            placeholder='Search by order, consignment, phone...'
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className='h-8 w-37.5 lg:w-62.5'
          />
          <div className='flex gap-x-2'>
            <ServerFilterDropdown
              title='Status'
              value={statusFilter}
              onValueChange={onStatusFilterChange}
              options={statusFilterOpts}
              counts={statusCounts}
            />
            <ServerFilterDropdown
              title='Courier'
              value={courierFilter}
              onValueChange={onCourierFilterChange}
              options={courierFilterOpts}
              counts={courierCounts}
            />
          </div>
          {(search || activeFilterCount > 0) && (
            <Button
              variant='ghost'
              onClick={() => {
                onSearchChange('')
                onResetFilters()
              }}
              className='h-8 px-2 lg:px-3'
            >
              Reset
              <Cross2Icon className='ms-2 h-4 w-4' />
            </Button>
          )}
        </div>
        <DataTableViewOptions table={table} />
      </div>
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

      <DataTableBulkActions table={table} entityName='dispatch'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='outline'
              size='icon'
              className='size-8'
              disabled={isSyncing}
              onClick={() => {
                const selectedIds = table
                  .getFilteredSelectedRowModel()
                  .rows.map((row) => row.original.id)
                table.resetRowSelection()
                onSyncSelected(selectedIds)
              }}
              aria-label='Sync status from courier'
              title='Sync status from courier'
            >
              <RefreshCw className={cn(isSyncing && 'animate-spin')} />
              <span className='sr-only'>Sync status from courier</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Sync status from courier</p>
          </TooltipContent>
        </Tooltip>
      </DataTableBulkActions>
    </div>
  )
}
