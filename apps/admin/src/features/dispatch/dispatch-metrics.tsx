import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDispatchMetrics } from './hooks'

export function DispatchMetrics() {
  const { data, isLoading } = useDispatchMetrics()

  if (isLoading) {
    return (
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className='pb-2'>
              <Skeleton className='h-4 w-24' />
            </CardHeader>
            <CardContent>
              <Skeleton className='h-8 w-16' />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!data) return null

  const total = data.total
  const courierCounts = data.byCourier ?? []
  const statusCounts = data.byStatus ?? []

  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm font-medium text-muted-foreground'>
            Total Dispatches
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='text-3xl font-bold'>{total}</div>
        </CardContent>
      </Card>
      {courierCounts.map(({ courier, count }) => (
        <Card key={courier}>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-muted-foreground capitalize'>
              {courier}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold'>{count}</div>
          </CardContent>
        </Card>
      ))}
      {statusCounts.slice(0, 4).map(({ status, count }) => (
        <Card key={status}>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-muted-foreground'>
              {status.replace(/_/g, ' ')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold'>{count}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
