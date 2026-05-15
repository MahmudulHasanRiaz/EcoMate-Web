import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RefreshCw, Truck, CreditCard, Store } from 'lucide-react'

const links = [
  { title: 'Order Statuses', desc: 'Customize order lifecycle transitions', icon: RefreshCw, to: '/settings/system/order-statuses' },
  { title: 'Courier', desc: 'Configure Steadfast, Pathao, RedX, Carrybee', icon: Truck, to: '/settings/system/courier' },
  { title: 'Gateways', desc: 'Payment gateways & manual methods', icon: CreditCard, to: '/settings/system/gateways' },
  { title: 'Storage', desc: 'R2 or local file storage', icon: Store, to: '/settings/system/storage' },
]

export function SystemSettings() {
  return (
    <div>
      <h2 className='text-2xl font-bold tracking-tight mb-6'>System Settings</h2>
      <div className='grid gap-4 md:grid-cols-2'>
        {links.map(l => (
          <Link key={l.to} to={l.to} className='block'>
            <Card className='cursor-pointer hover:shadow-md transition-shadow h-full'>
              <CardHeader className='flex flex-row items-center gap-3 pb-2'>
                <div className='bg-muted p-2 rounded-lg'><l.icon className='h-5 w-5' /></div>
                <CardTitle className='text-sm'>{l.title}</CardTitle>
              </CardHeader>
              <CardContent><p className='text-xs text-muted-foreground'>{l.desc}</p></CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
