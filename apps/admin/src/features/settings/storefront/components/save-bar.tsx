import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

interface SaveBarProps {
  isDirty: boolean
  isSaving: boolean
  dirtyCount: number
  lastSavedAt: Date | null
  onSave: () => void
  onReset: () => void
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export function SaveBar({ isDirty, isSaving, dirtyCount, lastSavedAt, onSave, onReset }: SaveBarProps) {
  if (!isDirty && !isSaving) return null

  const metaText = lastSavedAt
    ? `${dirtyCount} unsaved change${dirtyCount !== 1 ? 's' : ''} \u00b7 saved ${formatRelativeTime(lastSavedAt)}`
    : `${dirtyCount} unsaved change${dirtyCount !== 1 ? 's' : ''}`

  return (
    <div className='border-t border-border/40 pt-4 mt-6 flex items-center justify-between'>
      <span className='text-xs text-muted-foreground'>{metaText}</span>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-8 text-xs text-muted-foreground hover:text-foreground'
          onClick={onReset}
          disabled={isSaving}
        >
          Discard
        </Button>
        <Button
          type='button'
          size='sm'
          className='h-8 px-4 text-xs font-medium'
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving && <Loader2 className='animate-spin h-3.5 w-3.5 mr-1.5' />}
          Save Section
        </Button>
      </div>
    </div>
  )
}
