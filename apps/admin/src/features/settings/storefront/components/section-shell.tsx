import type { ReactNode } from 'react'
import { SaveBar } from './save-bar'
import { DirtyDot } from './dirty-dot'
import type { SectionId } from '@/features/settings/storefront/lib/categories'

interface SectionShellProps {
  id: SectionId
  title: string
  description: string
  isDirty: boolean
  isSaving: boolean
  dirtyCount: number
  lastSavedAt: Date | null
  onSave: () => void
  onReset: () => void
  children: ReactNode
}

export function SectionShell({
  id,
  title,
  description,
  isDirty,
  isSaving,
  dirtyCount,
  lastSavedAt,
  onSave,
  onReset,
  children,
}: SectionShellProps) {
  return (
    <div
      data-section-id={id}
      className='border border-border/60 rounded-xl bg-card p-4 scroll-mt-4'
    >
      <div className='flex items-center gap-2 mb-0.5'>
        <h3 className='text-sm font-medium text-foreground'>{title}</h3>
        <DirtyDot isDirty={isDirty} isSaving={isSaving} />
      </div>
      <p className='text-xs text-muted-foreground mb-3'>{description}</p>
      <div className='border-t border-border/40 pt-3 space-y-3'>
        {children}
      </div>
      <SaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        dirtyCount={dirtyCount}
        lastSavedAt={lastSavedAt}
        onSave={onSave}
        onReset={onReset}
      />
    </div>
  )
}
