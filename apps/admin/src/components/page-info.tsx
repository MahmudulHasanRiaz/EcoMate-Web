import { Info } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Page descriptions live behind this info affordance, not as visible text
 * blocks under the title (owner UX rule, 2026-11-02): long explanatory
 * paragraphs hurt the scanning experience; the explanation stays one
 * hover/tap away for anyone who wants it.
 */
export function PageInfo({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          aria-label='About this page'
          className={cn(
            'shrink-0 text-muted-foreground transition-colors hover:text-foreground',
            className,
          )}
        >
          <Info className='h-4 w-4' />
        </button>
      </TooltipTrigger>
      <TooltipContent className='max-w-xs'>{text}</TooltipContent>
    </Tooltip>
  )
}
