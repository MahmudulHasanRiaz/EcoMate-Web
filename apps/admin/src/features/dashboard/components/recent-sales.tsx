import type { RecentOrder } from '../api'

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

interface RecentSalesProps {
  orders: RecentOrder[]
}

export function RecentSales({ orders }: RecentSalesProps) {
  if (orders.length === 0) {
    return (
      <div className='py-8 text-center text-sm text-muted-foreground'>
        No recent orders
      </div>
    )
  }

  return (
    <div className='space-y-8'>
      {orders.map((order) => (
        <div key={order.id} className='flex items-center gap-4'>
          <div className='flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-medium'>
            #{order.displayId.slice(-2)}
          </div>
          <div className='flex flex-1 flex-wrap items-center justify-between'>
            <div className='space-y-1'>
              <p className='text-sm leading-none font-medium'>
                #{order.displayId}
              </p>
              <p className='text-sm text-muted-foreground'>
                {order.itemCount} item{order.itemCount !== 1 ? 's' : ''} &middot;{' '}
                {order.status}
              </p>
            </div>
            <div className='font-medium'>{formatCurrency(order.total)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
