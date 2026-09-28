import { ClipboardCopy } from 'lucide-react'
import { IconWhatsapp } from '@/assets/brand-icons'
import { whatsappLink } from '@/lib/phone-utils'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface CustomerContactActionsProps {
  phone?: string | null
  className?: string
  iconClassName?: string
}

/**
 * Compact contact actions rendered BESIDE a phone number that is already the
 * call affordance (every call site renders the number itself as a `tel:` link).
 * Deliberately renders no call icon of its own — that would duplicate the link.
 * - Clipboard icon copies the raw number.
 * - WhatsApp badge opens `https://wa.me/<number>` in a new tab.
 */
export function CustomerContactActions({ phone, className, iconClassName }: CustomerContactActionsProps) {
  if (!phone) return null
  const waUrl = whatsappLink(phone)

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex items-center', className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              onClick={(e) => { e.stopPropagation(); copyToClipboard(phone, 'Phone') }}
              className={`text-muted-foreground/50 hover:text-foreground transition-colors p-0.5 ${iconClassName || ''}`}
              aria-label={`Copy phone ${phone}`}
            >
              <ClipboardCopy className='h-3 w-3' />
            </button>
          </TooltipTrigger>
          <TooltipContent>Copy phone</TooltipContent>
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
