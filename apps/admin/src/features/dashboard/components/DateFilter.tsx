import { useState, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { useDateFilter } from '../use-date-filter'
import { DATE_PRESETS } from '../constants'
import type { DatePresetKey } from '../types'

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
    <div className="flex items-center gap-2 flex-wrap">
      {DATE_PRESETS.filter(p => p.key !== 'custom').map(p => (
        <Button
          key={p.key}
          variant={preset === p.key ? 'default' : 'outline'}
          size="sm"
          onClick={() => setPreset(p.key)}
          className="text-xs h-8"
        >
          {p.label}
        </Button>
      ))}
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <Button variant={preset === 'custom' ? 'default' : 'outline'} size="sm" className="text-xs h-8 gap-1">
            <Calendar className="h-3 w-3" />
            {preset === 'custom' ? `${formatParam(dateRange.start)} — ${formatParam(dateRange.end)}` : 'Custom'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="end">
          <div className="flex flex-col gap-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Start Date</p>
              <CalendarComponent mode="single" selected={startDate} onSelect={d => setStartDate(d)} initialFocus />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">End Date</p>
              <CalendarComponent mode="single" selected={endDate} onSelect={d => setEndDate(d)} initialFocus />
            </div>
            <Button
              size="sm"
              disabled={!startDate || !endDate}
              onClick={() => {
                if (startDate && endDate) {
                  setCustomRange(formatParam(startDate), formatParam(endDate))
                  setCustomOpen(false)
                }
              }}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
