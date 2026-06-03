'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface MultiSearchableOption {
  id: string
  label: string
  subLabel?: string
  depth?: number
}

interface MultiSearchableSelectProps {
  options: MultiSearchableOption[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  emptyMessage?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
}

export function MultiSearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  emptyMessage = 'No options found',
  searchPlaceholder = 'Search...',
  disabled = false,
  className,
}: MultiSearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const filteredOptions = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((opt) =>
      opt.label.toLowerCase().includes(q) ||
      (opt.subLabel && opt.subLabel.toLowerCase().includes(q))
    )
  }, [options, query])

  const selectedOptions = React.useMemo(
    () => options.filter((opt) => value.includes(opt.id)),
    [options, value]
  )

  const toggleOption = (id: string) => {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    )
  }

  const removeOption = (id: string) => {
    onChange(value.filter((v) => v !== id))
  }

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          className={cn(
            'w-full justify-between shadow-sm bg-background font-normal min-h-8 text-sm border border-input rounded-md px-3',
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
          disabled={disabled}
        >
          <div className='flex flex-wrap gap-1 flex-1 mr-1'>
            {selectedOptions.length > 0 ? (
              selectedOptions.slice(0, 3).map((opt) => (
                <Badge key={opt.id} variant='secondary' className='text-xs gap-1 max-w-[120px]'>
                  <span className='truncate'>{opt.label}</span>
                  <button
                    type='button'
                    onClick={(e) => { e.stopPropagation(); removeOption(opt.id) }}
                    className='hover:text-destructive shrink-0'
                  >
                    <X className='h-3 w-3' />
                  </button>
                </Badge>
              ))
            ) : (
              <span className='text-muted-foreground'>{placeholder}</span>
            )}
            {selectedOptions.length > 3 && (
              <Badge variant='secondary' className='text-xs'>+{selectedOptions.length - 3}</Badge>
            )}
          </div>
          <ChevronsUpDown className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0 shadow-md z-[9999]', className)}
        align='start'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex items-center border-b px-3 py-2 gap-2'>
          <Search className='h-4 w-4 text-muted-foreground shrink-0' />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className='h-8 text-sm border-0 focus-visible:ring-0 focus-visible:ring-offset-0'
            autoFocus
          />
        </div>
        <div className='max-h-[250px] overflow-y-auto p-1'>
          {filteredOptions.length === 0 ? (
            <div className='py-4 text-center text-xs text-muted-foreground'>
              {emptyMessage}
            </div>
          ) : (
            filteredOptions.map((opt) => (
              <button
                key={opt.id}
                type='button'
                onClick={() => toggleOption(opt.id)}
                className={cn(
                  'w-full text-left rounded-sm px-2 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                  value.includes(opt.id) && 'bg-accent text-accent-foreground'
                )}
              >
                <span className='flex items-center gap-2'>
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0',
                      value.includes(opt.id) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span
                    className='flex-1 truncate'
                    style={{ paddingLeft: (opt.depth || 0) * 16 }}
                  >
                    {opt.depth && opt.depth > 0 ? '— ' : ''}{opt.label}
                  </span>
                  {opt.subLabel && (
                    <span className='text-xs text-muted-foreground truncate'>{opt.subLabel}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
