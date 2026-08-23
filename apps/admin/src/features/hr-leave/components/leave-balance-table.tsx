import { Loader2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { useBalancesQuery } from '../hooks'

export function LeaveBalanceTable({ employeeId }: { employeeId?: string }) {
  const { data, isLoading, isError, refetch } = useBalancesQuery(employeeId)

  const rows = Array.isArray(data) ? data : []

  if (!employeeId) {
    return (
      <div className='py-8 text-center text-sm text-muted-foreground'>
        Select an employee to view balances.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='flex justify-center py-8'>
        <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
      </div>
    )
  }

  if (isError) {
    return (
      <div className='flex flex-col items-center gap-3 py-10 text-center'>
        <p className='text-sm text-muted-foreground'>Could not load leave balances.</p>
        <Button variant='outline' size='sm' onClick={() => refetch()}>
          <RotateCcw className='h-4 w-4 mr-1' /> Retry
        </Button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className='py-8 text-center text-sm text-muted-foreground'>
        No leave balances found for this employee.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead className='text-right'>Entitlement</TableHead>
          <TableHead className='text-right'>Used</TableHead>
          <TableHead className='text-right'>Remaining</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((b) => (
          <TableRow key={b.typeId}>
            <TableCell>
              <div className='font-medium'>{b.typeName}</div>
              {b.isPaid && (
                <Badge variant='outline' className='mt-1 text-[10px]'>Paid</Badge>
              )}
            </TableCell>
            <TableCell className='text-right tabular-nums'>{b.entitlement}</TableCell>
            <TableCell className='text-right tabular-nums'>{b.used}</TableCell>
            <TableCell
              className={`text-right font-semibold tabular-nums ${
                b.remaining <= 0 ? 'text-rose-600 dark:text-rose-400' : ''
              }`}
            >
              {b.remaining}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
