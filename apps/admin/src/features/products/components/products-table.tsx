import { useState } from 'react'
import { type SortingState, type VisibilityState, type PaginationState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DataTablePagination } from '@/components/data-table'
import { type ProductResponse } from '../api'
import { productsColumns } from './products-columns'

type Props = {
  data: ProductResponse[]; pageCount: number; pagination: PaginationState;
  onPaginationChange: (p: PaginationState) => void; isLoading?: boolean;
  onEdit: (row: ProductResponse) => void; onDelete: (row: ProductResponse) => void;
}

export function ProductsTable({ data, pageCount, pagination, onPaginationChange, isLoading, onEdit, onDelete }: Props) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility] = useState<VisibilityState>({})

  const columns = productsColumns(onEdit, onDelete)

  const table = useReactTable({
    data, columns, pageCount, state: { sorting, pagination, columnVisibility },
    manualPagination: true, onPaginationChange: (updater) => {
      const newState = typeof updater === 'function' ? updater(pagination) : updater;
      onPaginationChange(newState);
    },
    onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <div className='overflow-hidden rounded-md border'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(hg => (
              <TableRow key={hg.id}>
                {hg.headers.map(h => (
                  <TableHead key={h.id} colSpan={h.colSpan} className={cn(h.column.columnDef.meta as any)}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className='h-24 text-center'>Loading...</TableCell></TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={10} className='h-24 text-center text-muted-foreground'>No products found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} className='mt-auto' />
    </div>
  )
}
