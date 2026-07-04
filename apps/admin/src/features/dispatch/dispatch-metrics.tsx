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

  if (!data?.length) return null

  const total = data.reduce((sum, d) => sum + d._count, 0)

  const courierCounts = data.reduce<Record<string, number>>((acc, d) => {
    acc[d.courier] = (acc[d.courier] || 0) + d._count
    return acc
  }, {})

  const statusCounts = data.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + d._count
    return acc
  }, {})

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
      {Object.entries(courierCounts).map(([courier, count]) => (
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
      {Object.entries(statusCounts).slice(0, 4).map(([status, count]) => (
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
