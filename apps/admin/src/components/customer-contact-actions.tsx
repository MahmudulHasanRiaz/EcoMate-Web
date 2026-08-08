import { Phone, ClipboardCopy } from 'lucide-react'
import { IconWhatsapp } from '@/assets/brand-icons'
import { whatsappLink } from '@/lib/phone-utils'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface CustomerContactActionsProps {
  phone?: string | null
  className?: string
  showCopy?: boolean
  iconClassName?: string
}

/**
 * Renders compact call + WhatsApp action buttons for a customer phone number.
 * - Phone icon opens `tel:` (in-app call on supported devices).
 * - WhatsApp badge opens `https://wa.me/<number>` in a new tab.
 * - Optional copy button copies the raw number to clipboard.
 */
export function CustomerContactActions({ phone, className, showCopy = false, iconClassName }: CustomerContactActionsProps) {
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
              className={`text-muted-foreground hover:text-primary transition-colors p-0.5 ${iconClassName || ''}`}
              aria-label={`Call ${phone}`}
            >
              <Phone className='h-3 w-3' />
            </a>
          </TooltipTrigger>
          <TooltipContent>Call {phone}</TooltipContent>
        </Tooltip>

        {showCopy && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => { e.stopPropagation(); copyToClipboard(phone, 'Phone') }}
                className={`text-muted-foreground/50 hover:text-foreground transition-colors p-0.5 ${iconClassName || ''}`}
                aria-label={`Copy phone ${phone}`}
              >
                <ClipboardCopy className='h-3 w-3' />
              </button>
            </TooltipTrigger>
            <TooltipContent>Copy phone</TooltipContent>
          </Tooltip>
        )}

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