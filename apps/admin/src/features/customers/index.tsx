import { useState } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronDown, ChevronUp, Package, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table'
import { DataTablePagination } from '@/components/data-table'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { useCustomersQuery, useCustomerOrderSummary } from './hooks'
import { type CustomerResponse } from './api'

const columns: ColumnDef<CustomerResponse>[] = [
  {
    id: 'fullName',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Name' />
    ),
    cell: ({ row }) => {
      const { firstName, lastName } = row.original
      return (
        <span className='font-medium'>
          {firstName} {lastName}
        </span>
      )
    },
  },
  {
    accessorKey: 'phoneNumber',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Phone' />
    ),
    cell: ({ row }) => (
      <span className='text-nowrap'>{row.getValue('phoneNumber')}</span>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'email',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Email' />
    ),
    cell: ({ row }) => (
      <span className='text-nowrap'>{row.getValue('email')}</span>
    ),
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Registered Date' />
    ),
    cell: ({ row }) => {
      const date = row.getValue('createdAt') as string
      return (
        <span className='text-nowrap'>
          {date ? format(new Date(date), 'MMM d, yyyy') : '-'}
        </span>
      )
    },
  },
  {
    id: 'totalOrders',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Total Orders' />
    ),
    cell: ({ row }) => {
      return (
        <Button
          variant='ghost'
          size='sm'
          className='h-8 text-muted-foreground'
          onClick={(e) => {
            e.stopPropagation()
            row.toggleExpanded()
          }}
        >
          View
        </Button>
      )
    },
    enableSorting: false,
  },
]

function CustomerDetail({ customer }: { customer: CustomerResponse }) {
  const { data: orderSummary, isLoading } = useCustomerOrderSummary(
    customer.phoneNumber
  )

  if (isLoading) {
    return (
      <div className='flex items-center gap-2 px-4 py-8'>
        <Loader2 className='h-4 w-4 animate-spin' />
        <span className='text-sm text-muted-foreground'>
          Loading order summary...
        </span>
      </div>
    )
  }

  return (
    <div className='grid gap-4 px-4 py-4 md:grid-cols-3'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
          <CardTitle className='text-sm font-medium'>Total Orders</CardTitle>
          <Package className='h-4 w-4 text-muted-foreground' />
        </CardHeader>
        <CardContent>
          <div className='text-2xl font-bold'>
            {orderSummary?.summary?.totalOrders ?? 0}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
          <CardTitle className='text-sm font-medium'>Total Spent</CardTitle>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
            className='h-4 w-4 text-muted-foreground'
          >
            <path d='M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' />
          </svg>
        </CardHeader>
        <CardContent>
          <div className='text-2xl font-bold'>
            ৳{Number(orderSummary?.summary?.totalSpent ?? 0).toFixed(2)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
          <CardTitle className='text-sm font-medium'>Last Order</CardTitle>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
            className='h-4 w-4 text-muted-foreground'
          >
            <rect width='18' height='18' x='3' y='4' rx='2' ry='2' />
            <line x1='16' x2='16' y1='2' y2='6' />
            <line x1='8' x2='8' y1='2' y2='6' />
            <line x1='3' x2='21' y1='10' y2='10' />
          </svg>
        </CardHeader>
        <CardContent>
          <div className='text-2xl font-bold'>
            {orderSummary?.summary?.lastOrderDate
              ? format(new Date(orderSummary.summary.lastOrderDate), 'MMM d, yyyy')
              : 'N/A'}
          </div>
        </CardContent>
      </Card>

      {orderSummary?.recentOrders && orderSummary.recentOrders.length > 0 && (
        <Card className='md:col-span-3'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='overflow-hidden rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderSummary.recentOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className='font-mono text-xs'>
                        {order.id}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant='outline'
                          className='capitalize'
                          style={{ borderColor: order.status.color, color: order.status.color }}
                        >
                          {order.status.name}
                        </Badge>
                      </TableCell>
                      <TableCell>৳{Number(order.total).toFixed(2)}</TableCell>
                      <TableCell className='text-nowrap'>
                        {format(new Date(order.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function Customers() {
  const [search, setSearch] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [sorting, setSorting] = useState<SortingState>([])
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  const { data, isLoading } = useCustomersQuery({
    page: pagination.pageIndex + 1,
    perPage: pagination.pageSize,
    search: search || undefined,
  })

  const table = useReactTable({
    data: data?.data || [],
    columns,
    pageCount: data?.meta?.totalPages || 0,
    state: {
      pagination,
      sorting,
    },
    manualPagination: true,
    onPaginationChange: (updater) => {
      if (typeof updater === 'function') {
        const newState = updater(pagination)
        setPagination(newState)
      } else {
        setPagination(updater)
      }
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <>
      <Header fixed>
        <div className='me-auto flex flex-1 items-center gap-2'>
          <Input
            placeholder='Search by name, email, or phone...'
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPagination((prev) => ({ ...prev, pageIndex: 0 }))
            }}
            className='h-8 w-full sm:w-80'
          />
        </div>
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Customers</h2>
          <p className='text-muted-foreground'>
            View customer details and order history.
          </p>
        </div>

        <div className='flex flex-1 flex-col gap-4'>
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
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
                  table.getRowModel().rows.map((row) => [
                    <TableRow
                      key={row.id}
                      className={cn(
                        'cursor-pointer transition-colors hover:bg-muted/50',
                        expandedRowId === row.original.id && 'bg-muted/30'
                      )}
                      onClick={() =>
                        setExpandedRowId(
                          expandedRowId === row.original.id
                            ? null
                            : row.original.id
                        )
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          <div className='flex items-center gap-2'>
                            {cell.column.id === 'totalOrders' && (
                              expandedRowId === row.original.id ? (
                                <ChevronUp className='h-4 w-4 text-muted-foreground' />
                              ) : (
                                <ChevronDown className='h-4 w-4 text-muted-foreground' />
                              )
                            )}
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>,
                    expandedRowId === row.original.id && (
                      <TableRow key={`${row.id}-detail`}>
                        <TableCell colSpan={columns.length} className='p-0'>
                          <CustomerDetail customer={row.original} />
                        </TableCell>
                      </TableRow>
                    ),
                  ])
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
          <DataTablePagination table={table} className='mt-auto' />
        </div>
      </Main>
    </>
  )
}
