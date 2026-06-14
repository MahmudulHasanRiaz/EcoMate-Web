'use client'

import { useState, useEffect } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { useDateFilter } from '../use-date-filter'
import type { DatePresetKey } from '../types'

interface PresetOption {
  key: DatePresetKey
  label: string
}

const DISPLAY_PRESETS: PresetOption[] = [
  { key: 'today', label: 'Today' },
  { key: 'last_7_days', label: '7D' },
  { key: 'last_30_days', label: '30D' },
  { key: 'this_month', label: 'Month' },
  { key: 'this_quarter', label: 'Quarter' },
]

export function DateFilter() {
  const { preset, dateRange, setPreset, setCustomRange, formatParam } = useDateFilter()
  const [customOpen, setCustomOpen] = useState(false)
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)

  useEffect(() => {
    if (!customOpen) {
      setStartDate(undefined)
      setEndDate(undefined)
    }
  }, [customOpen])

  return (
    <div className="flex items-center gap-1.5 w-full md:w-auto overflow-x-auto whitespace-nowrap scrollbar-none py-1">
      <div className="inline-flex h-8 items-center rounded-lg bg-muted p-1 text-muted-foreground border border-border/50">
        {DISPLAY_PRESETS.map(p => {
          const isActive = preset === p.key
          return (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`rounded-md px-3 py-1 text-xs font-bold transition-all ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'hover:bg-background/40 hover:text-foreground/90'
              }`}
            >
              {p.label}
            </button>
          )
        })}

        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <button
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold transition-all ${
                preset === 'custom'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'hover:bg-background/40 hover:text-foreground/90'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>
                {preset === 'custom'
                  ? `${formatParam(dateRange.start)} - ${formatParam(dateRange.end)}`
                  : 'Custom'}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-4" align="end">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-bold text-muted-foreground">Start Date</p>
                  <CalendarComponent
                    mode="single"
                    selected={startDate}
                    onSelect={d => setStartDate(d)}
                    initialFocus
                    className="rounded-md border border-border/50"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-muted-foreground">End Date</p>
                  <CalendarComponent
                    mode="single"
                    selected={endDate}
                    onSelect={d => setEndDate(d)}
                    initialFocus
                    className="rounded-md border border-border/50"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t pt-3 border-border/50">
                <Button variant="outline" size="sm" onClick={() => setCustomOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!startDate || !endDate}
                  onClick={() => {
                    if (startDate && endDate) {
                      setCustomRange(formatParam(startDate), formatParam(endDate))
                      setCustomOpen(false)
                    }
                  }}
                  className="text-xs"
                >
                  Apply Range
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
