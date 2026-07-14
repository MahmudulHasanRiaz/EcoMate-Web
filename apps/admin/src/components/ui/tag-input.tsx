'use client'

import * as React from 'react'
import { Check, Plus, Search, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { apiClient } from '@/lib/api-client'

interface TagOption {
  id: string
  name: string
  productCount: number
}

interface TagInputProps {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function TagInput({
  value,
  onChange,
  placeholder = 'Search or create tags...',
  disabled = false,
  className,
}: TagInputProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [tags, setTags] = React.useState<TagOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const fetchTags = React.useCallback(async (search: string) => {
    setLoading(true)
    try {
      const res = await apiClient.get('/tags', {
        params: search.trim() ? { search: search.trim() } : {},
      })
      const data = Array.isArray(res.data) ? res.data : res.data?.data || []
      setTags(data)
    } catch {
      setTags([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) fetchTags(query)
  }, [open, query, fetchTags])

  const selectedNames = new Set(value)

  const toggleTag = (tagName: string) => {
    onChange(
      selectedNames.has(tagName)
        ? value.filter(v => v !== tagName)
        : [...value, tagName]
    )
  }

  const removeTag = (tagName: string) => {
    onChange(value.filter(v => v !== tagName))
  }

  const createAndAdd = () => {
    if (!query.trim()) return
    const name = query.trim()
    if (!selectedNames.has(name)) {
      onChange([...value, name])
    }
    setQuery('')
    setOpen(false)
  }

  const filteredTags = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tags.filter(t => !selectedNames.has(t.name))
    return tags.filter(
      t => t.name.toLowerCase().includes(q) && !selectedNames.has(t.name)
    )
  }, [tags, query, selectedNames])

  const noResults = !loading && filteredTags.length === 0
  const canCreate = query.trim() && !selectedNames.has(query.trim())

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className='flex flex-wrap gap-1.5 min-h-[36px] p-1.5 border rounded-md bg-background'>
        {value.length === 0 ? (
          <span className='text-xs text-muted-foreground px-1'>{placeholder}</span>
        ) : (
          value.map(t => (
            <Badge key={t} variant='secondary' className='gap-1 text-xs'>
              {t}
              <button
                type='button'
                onClick={() => removeTag(t)}
                className='hover:text-destructive shrink-0'
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          ))
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            size='sm'
            className='w-full justify-between text-xs h-7 font-normal'
            disabled={disabled}
          >
            <Search className='h-3 w-3 mr-1 text-muted-foreground' />
            <span className='text-muted-foreground'>Search or create tags...</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className='p-0 shadow-md z-[9999]'
          align='start'
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Enter' && canCreate) {
              e.preventDefault()
              createAndAdd()
            }
          }}
        >
          <div className='flex items-center border-b px-3 py-2 gap-2'>
            <Search className='h-4 w-4 text-muted-foreground shrink-0' />
            <Input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Type to search or create...'
              className='h-8 text-sm border-0 focus-visible:ring-0 focus-visible:ring-offset-0'
              autoFocus
            />
          </div>
          <div className='max-h-[220px] overflow-y-auto p-1'>
            {loading ? (
              <div className='py-4 flex items-center justify-center gap-2 text-xs text-muted-foreground'>
                <Loader2 className='h-3 w-3 animate-spin' />
                Searching...
              </div>
            ) : noResults ? (
              <div className='py-4 text-center text-xs text-muted-foreground'>
                {canCreate ? (
                  <button
                    type='button'
                    onClick={createAndAdd}
                    className='flex items-center justify-center gap-2 w-full text-sm font-medium text-primary hover:text-primary/80 transition-colors'
                  >
                    <Plus className='h-4 w-4' />
                    Create &quot;{query.trim()}&quot;
                  </button>
                ) : (
                  'No tags found'
                )}
              </div>
            ) : (
              <>
                {filteredTags.map(t => (
                  <button
                    key={t.id}
                    type='button'
                    onClick={() => {
                      toggleTag(t.name)
                      setQuery('')
                      inputRef.current?.focus()
                    }}
                    className='w-full text-left rounded-sm px-2 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground'
                  >
                    <span className='flex items-center gap-2'>
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0',
                          selectedNames.has(t.name) ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className='flex-1 truncate'>{t.name}</span>
                      <span className='text-xs text-muted-foreground shrink-0'>
                        {t.productCount}
                      </span>
                    </span>
                  </button>
                ))}
                {canCreate && (
                  <button
                    type='button'
                    onClick={createAndAdd}
                    className='w-full text-left rounded-sm px-2 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground border-t border-border mt-1 pt-2'
                  >
                    <span className='flex items-center gap-2 text-primary font-medium'>
                      <Plus className='h-4 w-4' />
                      Create &quot;{query.trim()}&quot;
                    </span>
                  </button>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
