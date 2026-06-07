interface DirtyDotProps {
  isDirty: boolean
  isSaving?: boolean
  className?: string
}

export function DirtyDot({ isDirty, isSaving, className = '' }: DirtyDotProps) {
  if (!isDirty && !isSaving) return null
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full bg-primary transition-opacity duration-300 ${isSaving ? 'animate-pulse' : ''} ${className}`}
      aria-label={isSaving ? 'Saving...' : 'Unsaved changes'}
    />
  )
}
