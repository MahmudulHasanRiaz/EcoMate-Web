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
      className='border border-border/60 rounded-xl bg-card p-6 scroll-mt-4'
    >
      <div className='flex items-center gap-2 mb-1'>
        <h3 className='text-base font-medium text-foreground'>{title}</h3>
        <DirtyDot isDirty={isDirty} isSaving={isSaving} />
      </div>
      <p className='text-sm text-muted-foreground mb-4'>{description}</p>
      <div className='border-t border-border/40 pt-4 space-y-4'>
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
