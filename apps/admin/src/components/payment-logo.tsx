import bkashManualLogo from '@/assets/payment-logos/bkash-manual.svg'
import bkashPgwLogo from '@/assets/payment-logos/bkash-pgw.png'
import nagadLogo from '@/assets/payment-logos/nagad.svg'
import rocketLogo from '@/assets/payment-logos/rocket.svg'
import upayLogo from '@/assets/payment-logos/upay.svg'
import cellfinLogo from '@/assets/payment-logos/cellfin.png'
import { Badge } from '@/components/ui/badge'

const logoMap: Record<string, string> = {
  bkash: bkashManualLogo,
  bkash_pgw: bkashPgwLogo,
  nagad: nagadLogo,
  rocket: rocketLogo,
  upay: upayLogo,
  cellfin: cellfinLogo,
  selfin: cellfinLogo,
}

const labelMap: Record<string, string> = {
  bkash: 'bKash',
  bkash_pgw: 'bKash PGW',
  nagad: 'Nagad',
  rocket: 'Rocket',
  upay: 'Upay',
  cellfin: 'Cellfin',
  selfin: 'Selfin',
  cod: 'Cash on Delivery',
  card: 'Card',
}

const sizeMap = {
  sm: { container: 'h-6 px-2', img: 'h-3.5' },
  md: { container: 'h-8 px-3', img: 'h-5' },
  lg: { container: 'h-10 px-4', img: 'h-6' },
} as const

export function PaymentLogo({ method, size = 'md', showName = true }: { method: string; size?: 'sm' | 'md' | 'lg'; showName?: boolean }) {
  const key = (method || '').toLowerCase()
  const logo = logoMap[key]
  const label = labelMap[key] || method.toUpperCase()
  const dims = sizeMap[size]

  if (!logo) {
    if (key === 'cod') {
      return (
        <Badge variant='outline' className='flex items-center gap-1 font-normal'>
          <span className='text-xs'>💰</span>
          {showName && <span style={{ fontSize: size === 'sm' ? '0.65rem' : '0.75rem' }}>COD</span>}
        </Badge>
      )
    }
    return <Badge variant='outline' className='text-xs'>{label}</Badge>
  }

  return (
    <div className='flex items-center gap-1.5'>
      <div className={`${dims.container} rounded-md border border-border bg-white flex items-center justify-center overflow-hidden shrink-0`}>
        <img src={logo} alt={label} className={`${dims.img} w-auto object-contain`} />
      </div>
      {showName && <span className='text-xs font-medium text-muted-foreground'>{label}</span>}
    </div>
  )
}
