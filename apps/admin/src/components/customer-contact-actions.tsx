import { Phone } from 'lucide-react'
import { IconWhatsapp } from '@/assets/brand-icons'
import { whatsappLink } from '@/lib/phone-utils'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface CustomerContactActionsProps {
  phone?: string | null
  className?: string
}

/**
 * Renders compact call + WhatsApp action buttons for a customer phone number.
 * - Phone icon opens `tel:` (in-app call on supported devices).
 * - WhatsApp badge opens `https://wa.me/<number>` in a new tab.
 */
export function CustomerContactActions({ phone, className }: CustomerContactActionsProps) {
  if (!phone) return null
  const waUrl = whatsappLink(phone)

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex items-center', className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={`tel:${phone}`}
              onClick={(e) => e.stopPropagation()}
              className='text-muted-foreground hover:text-primary transition-colors p-0.5'
              aria-label={`Call ${phone}`}
            >
              <Phone className='h-3 w-3' />
            </a>
          </TooltipTrigger>
          <TooltipContent>Call {phone}</TooltipContent>
        </Tooltip>

        {waUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={waUrl}
                target='_blank'
                rel='noreferrer noopener'
                onClick={(e) => e.stopPropagation()}
                className='size-5 rounded-full bg-[#25D366] text-white flex items-center justify-center hover:opacity-90 transition-opacity shrink-0'
                aria-label={`WhatsApp ${phone}`}
              >
                <IconWhatsapp className='h-3 w-3' />
              </a>
            </TooltipTrigger>
            <TooltipContent>WhatsApp {phone}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}