import { useEffect, useMemo, useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { getAllSections, getCategoryById, type SectionId } from '@/features/settings/storefront/lib/categories'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigateToSection: (sectionId: SectionId) => void
}

interface SearchResult {
  type: 'section' | 'field'
  sectionId: SectionId
  label: string
  categoryLabel: string
}

export function CommandPalette({ open, onOpenChange, onNavigateToSection }: CommandPaletteProps) {
  const results = useMemo<SearchResult[]>(() => {
    const items: SearchResult[] = []
    for (const section of getAllSections()) {
      const category = getCategoryById(section.categoryId)
      items.push({
        type: 'section',
        sectionId: section.id,
        label: section.title,
        categoryLabel: category.label,
      })
      for (const fieldKey of section.fields) {
        const schema = FIELD_SCHEMAS[fieldKey]
        if (schema) {
          items.push({
            type: 'field',
            sectionId: section.id,
            label: schema.label,
            categoryLabel: category.label,
          })
        }
      }
    }
    return items
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title='Settings Search'>
      <CommandInput placeholder='Search settings and fields...' />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {(['identity', 'visuals', 'content', 'discovery', 'commerce'] as const).map(catId => {
          const catResults = results.filter(r => r.categoryLabel === getCategoryById(catId).label)
          if (catResults.length === 0) return null
          return (
            <CommandGroup key={catId} heading={getCategoryById(catId).label}>
              {catResults.map((result, idx) => (
                <CommandItem
                  key={`${result.sectionId}-${result.type}-${idx}`}
                  onSelect={() => {
                    onNavigateToSection(result.sectionId)
                    onOpenChange(false)
                    setTimeout(() => {
                      const sectionEl = document.querySelector(`[data-section-id="${result.sectionId}"]`)
                      if (sectionEl) {
                        sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        if (result.type === 'field') {
                          setTimeout(() => {
                            const firstInput = sectionEl.querySelector('[data-field-key]') as HTMLElement | null
                            firstInput?.focus()
                          }, 100)
                        }
                      }
                    }, 50)
                  }}
                >
                  <span className='text-sm'>{result.label}</span>
                  <span className='ml-auto text-[10px] text-muted-foreground'>{result.categoryLabel}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey) && !isInputElement(e.target as HTMLElement)) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return { open, setOpen }
}

function isInputElement(el: HTMLElement | null): boolean {
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}
