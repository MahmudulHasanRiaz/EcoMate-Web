import { cn } from '@/lib/utils'
import { DirtyDot } from './dirty-dot'
import type { CategoryMeta, SectionId, SectionMeta } from '@/features/settings/storefront/lib/categories'

interface CategorySidebarProps {
  categories: CategoryMeta[]
  sections: Record<SectionId, SectionMeta>
  activeSectionId: SectionId
  dirtySectionIds: Set<SectionId>
  onSectionClick: (id: SectionId) => void
  onOpenPalette: () => void
}

export function CategorySidebar({
  categories,
  sections,
  activeSectionId,
  dirtySectionIds,
  onSectionClick,
  onOpenPalette,
}: CategorySidebarProps) {
  return (
    <nav className='w-full space-y-3' aria-label='Settings categories'>
      <button
        onClick={onOpenPalette}
        className='w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground border border-border/60 rounded-md hover:bg-muted/50 transition-colors'
      >
        <kbd className='inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground/60'>
          <span className='text-xs'>⌘</span>K
        </kbd>
        <span>Search settings...</span>
      </button>

      {categories.map(category => (
        <div key={category.id}>
          <h4 className='px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1'>
            {category.label}
          </h4>
          <div className='space-y-0.5'>
            {category.sections.map(sectionId => {
              const section = sections[sectionId]
              if (!section) return null
              const isActive = sectionId === activeSectionId
              const isDirty = dirtySectionIds.has(sectionId)
              const Icon = section.icon
              return (
                <button
                  key={sectionId}
                  onClick={() => onSectionClick(sectionId)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left',
                    isActive
                      ? 'bg-accent/50 text-foreground font-medium border-l-2 border-primary'
                      : 'text-foreground/70 hover:text-foreground hover:bg-muted/30 border-l-2 border-transparent'
                  )}
                >
                  <Icon className='h-3.5 w-3.5 shrink-0' />
                  <span className='flex-1 truncate'>{section.title}</span>
                  <DirtyDot isDirty={isDirty} className='shrink-0' />
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
