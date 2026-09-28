import { ClipboardCopy, Check } from 'lucide-react'
import { useState } from 'react'
import { copyToClipboard } from '@/lib/clipboard'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  text: string
  label?: string
  className?: string
  iconClassName?: string
}

/**
 * Subtle copy-to-clipboard button for identifiers (order IDs, phone numbers).
 * Renders a muted clipboard icon that highlights on hover; shows a green
 * check for 1.5s after copying and fires the shared copy toast.
 */
export function CopyButton({ text, label, className, iconClassName }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  if (!text) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation()
            copyToClipboard(text, label)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className={cn('text-muted-foreground/50 hover:text-foreground transition-colors p-0.5', className)}
          aria-label={label ? `Copy ${label}` : 'Copy to clipboard'}
          title={label ? `Copy ${label}` : 'Copy to clipboard'}
        >
          {copied
            ? <Check className={cn('h-3 w-3 text-emerald-500', iconClassName)} />
            : <ClipboardCopy className={cn('h-3 w-3', iconClassName)} />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label ? `Copy ${label}` : 'Copy to clipboard'}</TooltipContent>
    </Tooltip>
  )
}
