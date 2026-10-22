import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/** Roles allowed to inspect IP / user-agent / tracking identifiers. */
export const OTHERS_INFO_ROLES = ['superadmin', 'admin'] as const

export function canViewOthersInfo(role?: string | null): boolean {
  return !!role && (OTHERS_INFO_ROLES as readonly string[]).includes(role)
}

/**
 * Part 6: compact icon-only entry to "Others Information" — 32×32, same role
 * gate and same dialog as before.
 */
export function OthersInfoIconButton({
  role,
  onOpen,
}: {
  role?: string | null
  onOpen: () => void
}) {
  if (!canViewOthersInfo(role)) return null
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='outline'
            size='icon'
            className='h-8 w-8 shrink-0'
            aria-label='Others Information'
            onClick={onOpen}
          >
            <Info className='h-3.5 w-3.5' />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Others Information</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
