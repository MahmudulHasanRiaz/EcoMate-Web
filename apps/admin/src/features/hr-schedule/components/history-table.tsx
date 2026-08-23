import { Loader2, ChevronLeft, ChevronRight, ArrowRight, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import type { HistoryEntry } from '../api'

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  department: 'Department',
  designation: 'Designation',
  reporting_manager: 'Reporting Manager',
  employment_type: 'Employment Type',
  weekly_off: 'Weekly Off',
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatValue(field: string, value: string | null) {
  if (value == null || value === '') return '—'
  if (field === 'weekly_off') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed) && parsed.length === 0) return '—'
      if (Array.isArray(parsed)) {
        return parsed.map((d: number) => DAY_NAMES[d] ?? d).join(', ')
      }
    } catch {
      // fall through to raw value
    }
  }
  return value
}

interface HistoryTableProps {
  data: HistoryEntry[]
  meta: { total: number; page: number; perPage: number; totalPages: number } | undefined
  isLoading: boolean
  isError?: boolean
  onRetry?: () => void
  onPageChange: (page: number) => void
}

export function HistoryTable({ data, meta, isLoading, isError, onRetry, onPageChange }: HistoryTableProps) {
  return (
    <div>
      {isLoading ? (
        <div className='flex justify-center py-8'>
          <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
        </div>
      ) : isError ? (
        <div className='flex flex-col items-center gap-3 py-10 text-center'>
          <p className='text-sm text-muted-foreground'>Could not load change history.</p>
          <Button variant='outline' size='sm' onClick={() => onRetry?.()}>
            <RotateCcw className='h-4 w-4 mr-1' /> Retry
          </Button>
        </div>
      ) : data.length === 0 ? (
        <div className='py-8 text-center text-sm text-muted-foreground'>No changes recorded yet</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Field</TableHead>
              <TableHead className='w-[45%]'>Change</TableHead>
              <TableHead>Changed By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className='text-sm'>{formatDate(entry.effectiveFrom)}</TableCell>
                <TableCell className='text-sm font-medium'>{FIELD_LABELS[entry.field] || entry.field}</TableCell>
                <TableCell className='text-sm'>
                  <span className='inline-flex items-center gap-1.5 text-muted-foreground'>
                    <span className='max-w-[40%] truncate'>{formatValue(entry.field, entry.oldValue)}</span>
                    <ArrowRight className='h-3 w-3 shrink-0' />
                    <span className='max-w-[40%] truncate font-medium text-foreground'>
                      {formatValue(entry.field, entry.newValue)}
                    </span>
                  </span>
                </TableCell>
                <TableCell className='text-sm text-muted-foreground'>
                  {entry.changedBy ? `${entry.changedBy.firstName} ${entry.changedBy.lastName}` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {meta && meta.totalPages > 1 && (
        <div className='flex items-center justify-between border-t px-4 py-3'>
          <span className='text-sm text-muted-foreground'>
            Page {meta.page} of {meta.totalPages}
          </span>
          <div className='flex items-center gap-1'>
            <Button
              variant='outline' size='icon' className='h-8 w-8'
              disabled={meta.page <= 1}
              onClick={() => onPageChange(Math.max(1, meta.page - 1))}
            ><ChevronLeft className='h-4 w-4' /></Button>
            <Button
              variant='outline' size='icon' className='h-8 w-8'
              disabled={meta.page >= meta.totalPages}
              onClick={() => onPageChange(Math.min(meta.totalPages, meta.page + 1))}
            ><ChevronRight className='h-4 w-4' /></Button>
          </div>
        </div>
      )}
    </div>
  )
}