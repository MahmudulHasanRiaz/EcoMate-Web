'use client';

import * as React from 'react'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface SearchableOption {
  id: string
  label: string
  subLabel?: string
  icon?: React.ReactNode
}

interface SearchableSelectProps {
  options: SearchableOption[]
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  emptyMessage?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  emptyMessage = 'No options found',
  searchPlaceholder = 'Search...',
  disabled = false,
  className,
  triggerClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const selectedOption = React.useMemo(
    () => options.find((opt) => opt.id === value),
    [options, value]
  )

  const filteredOptions = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((opt) => 
      opt.label.toLowerCase().includes(q) || 
      (opt.subLabel && opt.subLabel.toLowerCase().includes(q))
    )
  }, [options, query])

  const handleSelect = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
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
            'w-full justify-between shadow-sm bg-background font-normal h-8 text-sm border border-input rounded-md px-3',
            disabled && 'opacity-50 cursor-not-allowed',
            triggerClassName
          )}
          disabled={disabled}
        >
          <span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
            {selectedOption ? (
              <span className='flex items-center gap-1.5'>
                {selectedOption.icon}
                {selectedOption.label}
              </span>
            ) : placeholder}
          </span>
          <div className='flex items-center gap-1'>
            {selectedOption && (
              <X 
                className='h-3 w-3 text-muted-foreground hover:text-foreground' 
                onClick={handleClear}
              />
            )}
            <ChevronsUpDown className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className={cn('p-0 shadow-md z-[9999]', className)} 
        align='start'
      >
        <div className='flex items-center border-b px-3 py-2 gap-2'>
          <Search className='h-4 w-4 text-muted-foreground shrink-0' />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className='h-8 text-sm border-0 focus-visible:ring-0 focus-visible:ring-offset-0'
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
                onClick={() => handleSelect(opt.id)}
                className={cn(
                  'w-full text-left rounded-sm px-2 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                  value === opt.id && 'bg-accent text-accent-foreground font-medium'
                )}
              >
                <span className='flex items-center gap-2'>
                  <Check 
                    className={cn(
                      'h-4 w-4 shrink-0', 
                      value === opt.id ? 'opacity-100' : 'opacity-0'
                    )} 
                  />
                  {opt.icon && <span className='shrink-0'>{opt.icon}</span>}
                  <span className='flex-1 truncate'>{opt.label}</span>
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