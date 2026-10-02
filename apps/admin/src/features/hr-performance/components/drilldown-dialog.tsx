import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useOrderDrilldownQuery } from '../hooks'
import { ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react'

interface DrilldownDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  employeeName: string
  from?: string
  to?: string
}

export function DrilldownDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  from,
  to,
}: DrilldownDialogProps) {
  const [stage, setStage] = useState<string>('handled')
  const [page, setPage] = useState(1)

  // isError was never read, so a failed request fell through to the empty
  // branch and the dialog claimed "No orders found in this stage cohort" —
  // a confident lie on top of a 403 or 500.
  const { data, isLoading, isError, refetch } = useOrderDrilldownQuery(
    employeeId,
    { from, to, stage, page, perPage: 10 },
    open,
  )

  const orders = data?.data || []
  const meta = data?.meta

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-4xl max-h-[85vh] flex flex-col p-6'>
        <DialogHeader>
          <div className='flex items-center gap-2'>
            <ShoppingBag className='h-5 w-5 text-primary' />
            <DialogTitle className='text-lg font-bold'>
              Orders Handled by {employeeName}
            </DialogTitle>
          </div>
          <p className='text-xs text-muted-foreground'>
            {from && to ? `${from} to ${to}` : 'All time records'}
          </p>
        </DialogHeader>

        {/* Stage Filter Buttons */}
        <div className='flex flex-wrap gap-2 pt-2'>
          {[
            { id: 'handled', label: 'All Handled' },
            { id: 'confirmed', label: 'Confirmed' },
            { id: 'delivered', label: 'Delivered' },
            { id: 'returned', label: 'Returned' },
            { id: 'cancelled', label: 'Cancelled' },
          ].map((tab) => (
            <Button
              key={tab.id}
              variant={stage === tab.id ? 'default' : 'outline'}
              size='sm'
              className='h-8 text-xs'
              onClick={() => {
                setStage(tab.id)
                setPage(1)
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Table */}
        <div className='flex-1 overflow-auto rounded-lg border border-border/50 mt-3'>
          <Table>
            <TableHeader className='bg-muted/40 sticky top-0'>
              <TableRow>
                <TableHead className='w-[140px]'>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='text-right'>Total</TableHead>
                <TableHead>Latest Action</TableHead>
                <TableHead>Action Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className='h-4 w-24' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-32' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-20' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-16 ml-auto' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-28' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-24' /></TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={6} className='text-center py-8'>
                    <span className='text-sm text-destructive'>
                      Could not load order records.
                    </span>
                    <button
                      type='button'
                      onClick={() => refetch()}
                      className='ml-2 text-xs font-medium text-primary underline-offset-2 hover:underline'
                    >
                      Retry
                    </button>
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className='text-center py-8 text-muted-foreground'>
                    No orders found in this stage cohort.
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => {
                  const latestEvent = order.events?.[0]
                  return (
                    <TableRow key={order.id}>
                      <TableCell className='font-mono font-semibold text-xs'>
                        {order.displayId}
                      </TableCell>
                      <TableCell>
                        <p className='text-xs font-medium'>{order.customerName || '—'}</p>
                        <p className='text-[10px] text-muted-foreground'>{order.customerPhone}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant='outline' className='text-[10px] uppercase font-bold'>
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right font-semibold text-xs tabular-nums'>
                        ৳{order.total?.toLocaleString() ?? 0}
                      </TableCell>
                      <TableCell className='text-xs text-muted-foreground'>
                        {latestEvent ? (
                          <span>
                            {/* Writers emit lowercase actions
                                (confirmed / delivered / returned /
                                cancelled / status_change / assigned), so the
                                previous 'STATUS_CHANGED' comparison was never
                                true and this column always fell back. */}
                            {latestEvent.toStatus
                              ? `→ ${latestEvent.toStatus}`
                              : latestEvent.action.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          'No recorded action'
                        )}
                      </TableCell>
                      <TableCell className='text-xs text-muted-foreground'>
                        {latestEvent?.createdAt
                          ? new Date(latestEvent.createdAt).toLocaleDateString()
                          : new Date(order.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between pt-3 border-t'>
            <span className='text-xs text-muted-foreground'>
              Page {meta.page} of {meta.totalPages} ({meta.total} orders)
            </span>
            <div className='flex items-center gap-1'>
              <Button
                variant='outline'
                size='sm'
                className='h-7 w-7 p-0'
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className='h-4 w-4' />
              </Button>
              <Button
                variant='outline'
                size='sm'
                className='h-7 w-7 p-0'
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
