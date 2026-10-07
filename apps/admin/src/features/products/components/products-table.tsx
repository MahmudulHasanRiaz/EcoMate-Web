import { useState, useEffect } from 'react'
import { type SortingState, type VisibilityState, type PaginationState, type RowSelectionState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DataTablePagination } from '@/components/data-table'
import { type ProductResponse } from '../api'
import { productsColumns } from './products-columns'
import { useInventoryManagement } from '@/features/inventory/hooks/use-inventory-management'

type Props = {
  data: ProductResponse[]; pageCount: number; totalCount: number; pagination: PaginationState;
  onPaginationChange: (p: PaginationState) => void; isLoading?: boolean;
  onEdit: (row: ProductResponse) => void; onDelete: (row: ProductResponse) => void;
  onToggleActive?: (row: ProductResponse, active: boolean) => void;
  onDuplicate?: (row: ProductResponse) => void;
  onPublish?: (row: ProductResponse) => void;
  selectedIds: string[]; onSelectionChange: (ids: string[]) => void;
  pageSizeOptions?: number[];
}

export function ProductsTable({ data, pageCount, totalCount, pagination, onPaginationChange, isLoading, onEdit, onDelete, onToggleActive, onDuplicate, onPublish, selectedIds, onSelectionChange, pageSizeOptions }: Props) {
  const { data: imEnabled = true } = useInventoryManagement()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>(() => {
    const sel: RowSelectionState = {};
    selectedIds.forEach(id => { sel[id] = true });
    return sel;
  })

  useEffect(() => {
    const sel: RowSelectionState = {};
    selectedIds.forEach(id => { sel[id] = true });
    setRowSelection(sel);
  }, [selectedIds]);

  const columns = productsColumns(onEdit, onDelete, onToggleActive, onDuplicate, imEnabled, onPublish)

  const table = useReactTable({
    data, columns, pageCount, state: { sorting, pagination, columnVisibility, rowSelection },
    enableRowSelection: true,
    getRowId: (row) => row.id,
    onRowSelectionChange: (updater) => {
      const newState = typeof updater === 'function' ? updater(rowSelection) : updater;
      setRowSelection(newState);
      onSelectionChange(Object.keys(newState).filter(k => newState[k]));
    },
    manualPagination: true, onPaginationChange: (updater) => {
      const newState = typeof updater === 'function' ? updater(pagination) : updater;
      onPaginationChange(newState);
    },
    onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <div className='rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader className='bg-muted/40 dark:bg-muted/20 sticky top-0 z-10 border-b border-border/70 backdrop-blur-xs'>
              {table.getHeaderGroups().map(hg => (
                <TableRow key={hg.id} className='hover:bg-transparent border-b border-border/70'>
                  {hg.headers.map(h => (
                    <TableHead key={h.id} colSpan={h.colSpan} className={cn('text-[11px] font-semibold uppercase tracking-wider text-muted-foreground', h.column.columnDef.meta as any)}>
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className='h-32 text-center text-muted-foreground font-medium'>Loading...</TableCell></TableRow>
              ) : table.getRowModel().rows.length ? (
                table.getRowModel().rows.map(row => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                    className={`group transition-colors border-b border-border/50 dark:border-border/40 ${
                      row.getIsSelected()
                        ? 'bg-primary/8 dark:bg-primary/15 hover:bg-primary/12 dark:hover:bg-primary/20'
                        : 'hover:bg-muted/40 dark:hover:bg-muted/20 even:bg-muted/[0.02] dark:even:bg-muted/[0.03]'
                    }`}
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id} className='py-2.5 px-3'>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={10} className='h-32 text-center text-muted-foreground font-medium'>No products found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <DataTablePagination table={table} className='mt-auto' totalCount={totalCount} pageSizeOptions={pageSizeOptions} />
    </div>
  )
}
