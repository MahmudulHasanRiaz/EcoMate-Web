import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import { Button } from '@/components/ui/button'

type Props = {
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
}

export function DataTablePagination({ page, totalPages, total, onPageChange }: Props) {
  return (
    <div className='flex items-center justify-between px-2 py-2'>
      <p className='text-sm text-muted-foreground'>{total} total</p>
      <div className='flex items-center gap-2'>
        <Button variant='outline' className='h-8 w-8 p-0' disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeftIcon className='h-4 w-4' />
        </Button>
        <span className='text-sm text-muted-foreground'>
          Page {page} of {totalPages}
        </span>
        <Button variant='outline' className='h-8 w-8 p-0' disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          <ChevronRightIcon className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}
