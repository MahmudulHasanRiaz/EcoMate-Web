'use client';

import * as React from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface StaffMember {
  id: string
  firstName: string
  lastName: string
  name?: string
}

interface StaffComboboxProps {
  staffMembers: StaffMember[]
  value: string
  onChange: (value: string) => void
  mode?: 'filter' | 'assign'
  disabled?: boolean
  placeholder?: string
}

export function StaffCombobox({
  staffMembers,
  value,
  onChange,
  mode = 'filter',
  disabled = false,
  placeholder,
}: StaffComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const selectedStaff = React.useMemo(
    () => staffMembers.find((s) => s.id === value),
    [staffMembers, value]
  )

  const getDisplayName = (s: StaffMember) => s.name || `${s.firstName} ${s.lastName}`.trim()

  const buttonLabel = value === 'all' 
    ? 'All Staff' 
    : value === 'unassigned' 
      ? 'Unassigned' 
      : selectedStaff 
        ? getDisplayName(selectedStaff) 
        : placeholder || (mode === 'filter' ? 'All Staff' : 'Assign...')

  const mainOptions = React.useMemo(() => {
    const opts: { id: string; name: string }[] = []
    if (mode === 'filter') {
      opts.push({ id: 'all', name: 'All Staff' })
    }
    opts.push({ id: 'unassigned', name: 'Unassigned' })
    return opts
  }, [mode])

  const filteredMainOptions = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return mainOptions
    return mainOptions.filter((opt) => opt.name.toLowerCase().includes(q))
  }, [mainOptions, query])

  const filteredStaffOptions = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return staffMembers
    return staffMembers.filter((opt) => getDisplayName(opt).toLowerCase().includes(q))
  }, [staffMembers, query])

  const handleSelect = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const hasMain = filteredMainOptions.length > 0
  const hasStaff = filteredStaffOptions.length > 0

  return (
    <Popover open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen)
      if (!isOpen) setQuery('')
    }}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          className={cn(
            'w-full justify-between shadow-sm bg-background/50 font-normal h-8 text-sm border border-input rounded-md px-3',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
          disabled={disabled}
        >
          <span className='truncate'>{buttonLabel}</span>
          <ChevronsUpDown className='ml-2 h-3.5 w-3.5 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[220px] p-0 shadow-md z-[9999]' align='start'>
        <div className='p-2 border-b'>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search staff...'
            className='h-8 text-sm'
            autoFocus
          />
        </div>
        <div className='max-h-[250px] overflow-y-auto p-1'>
          {!hasMain && !hasStaff && (
            <div className='py-4 text-center text-xs text-muted-foreground'>No staff found.</div>
          )}

          {hasMain && (
            <div className='mb-1'>
              {filteredMainOptions.map((opt) => (
                <button
                  key={opt.id}
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSelect(opt.id)
                  }}
                  className={cn(
                    'w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                    value === opt.id && 'bg-accent text-accent-foreground font-medium'
                  )}
                >
                  <span className='inline-flex items-center gap-2'>
                    <Check className={cn('h-4 w-4', value === opt.id ? 'opacity-100' : 'opacity-0')} />
                    <span className='truncate'>{opt.name}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {hasMain && hasStaff && <div className='h-px bg-border my-1 mx-1' />}

          {hasStaff && (
            <div>
              <div className='px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider'>Staff</div>
              {filteredStaffOptions.map((opt) => (
                <button
                  key={opt.id}
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSelect(opt.id)
                  }}
                  className={cn(
                    'w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                    value === opt.id && 'bg-accent text-accent-foreground'
                  )}
                >
                  <span className='inline-flex items-center gap-2'>
                    <Check className={cn('h-4 w-4', value === opt.id ? 'opacity-100' : 'opacity-0')} />
                    <span className='truncate'>{getDisplayName(opt)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}