import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RefreshCw, Truck, CreditCard, Store, Radio, Palette, FileText } from 'lucide-react'

const links = [
  { title: 'Branding', desc: 'Title, favicon, and identity for admin & storefront', icon: Palette, to: '/mon/settings/branding' },
  { title: 'Storefront', desc: 'Store content, social, SEO, footer, hero, delivery', icon: Store, to: '/mon/settings/storefront' },
  { title: 'Pages', desc: 'Terms, Privacy, Refund & other CMS pages', icon: FileText, to: '/mon/settings/pages' },
  { title: 'Order Statuses', desc: 'Customize order lifecycle transitions', icon: RefreshCw, to: '/mon/settings/order-statuses' },
  { title: 'Courier', desc: 'Configure Steadfast, Pathao, RedX, Hoorin', icon: Truck, to: '/mon/settings/courier' },
  { title: 'Gateways', desc: 'Payment gateways & manual methods', icon: CreditCard, to: '/mon/settings/gateways' },
  { title: 'Storage', desc: 'R2 or local file storage', icon: Store, to: '/mon/settings/storage' },
  { title: 'Tracking', desc: 'Meta CAPI & TikTok Events API', icon: Radio, to: '/mon/settings/tracking' },
]

export function SystemSettings() {
  const navigate = useNavigate()

  const handleClick = (to: string) => {
    navigate({ to })
  }

  return (
    <div>
      <h2 className='text-2xl font-bold tracking-tight mb-6'>System Settings</h2>
      <div className='grid gap-4 md:grid-cols-2'>
        {links.map(l => (
          <div key={l.to} onClick={() => handleClick(l.to)} className='block cursor-pointer'>
            <Card className='hover:shadow-md transition-shadow h-full'>
              <CardHeader className='flex flex-row items-center gap-3 pb-2'>
                <div className='bg-muted p-2 rounded-lg'><l.icon className='h-5 w-5' /></div>
                <CardTitle className='text-sm'>{l.title}</CardTitle>
              </CardHeader>
              <CardContent><p className='text-xs text-muted-foreground'>{l.desc}</p></CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  )
}
