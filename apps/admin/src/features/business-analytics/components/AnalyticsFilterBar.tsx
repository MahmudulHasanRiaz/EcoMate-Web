'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calendar as CalendarIcon, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DATE_PRESETS } from '../../dashboard/constants'
import { toDhakaDateString } from '@/lib/dhaka-time'
import { categoriesApi } from '../../categories/api'
import type { AnalyticsFilters } from '../types'

/** Backend-admissible presets (ANALYTICS_RANGE_PRESETS — no all_time). */
const PRESET_KEYS = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'this_quarter', 'this_year', 'custom'] as const

const SOURCES = ['POS', 'ECOMMERCE', 'MANUAL']
const SALES_CHANNELS = ['CALL', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'MESSENGER', 'WHATSAPP', 'THREADS', 'WALK_IN', 'WEBSITE', 'OFFLINE', 'POS', 'OTHER']
const SEGMENTS = ['new', 'returning', 'vip']
const OUTCOMES = ['delivered', 'returned', 'in_fulfilment', 'cancelled']
const COLLECTION = ['online-collected', 'cod-unavailable']

interface Props {
  value: AnalyticsFilters
  onChange: (next: AnalyticsFilters) => void
}

function DimSelect({
  label,
  value,
  options,
  onPick,
  placeholder,
  loading,
  disabled,
}: {
  label: string
  value?: string
  options: { value: string; label: string }[]
  onPick: (v: string | undefined) => void
  placeholder: string
  /** Async options still loading — trigger shows "Loading…" instead of a silent "All". */
  loading?: boolean
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select value={value ?? '__all'} disabled={disabled || loading} onValueChange={(v) => onPick(v === '__all' ? undefined : v)}>
        <SelectTrigger className="tap-h h-10 w-36 cursor-pointer text-xs">
          <SelectValue placeholder={loading ? 'Loading…' : placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{loading ? 'Loading…' : placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function FreeInput({
  label,
  value,
  onPick,
  placeholder,
}: {
  label: string
  value?: string
  onPick: (v: string | undefined) => void
  placeholder: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input
        value={value ?? ''}
        onChange={(e) => onPick(e.target.value || undefined)}
        placeholder={placeholder}
        className="tap-h h-10 w-36 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      />
    </label>
  )
}

/**
 * Overview filter bar (§4.1). Date preset + custom via DATE_PRESETS; every
 * dimension lands in the backend query — no client-only filtering. No Store:
 * the dimension does not exist (F7). Warehouse is inventory-scoped, so it is
 * not offered here.
 */
export function AnalyticsFilterBar({ value, onChange }: Props) {
  const set = (patch: Partial<AnalyticsFilters>) => onChange({ ...value, ...patch })
  const [customOpen, setCustomOpen] = useState(false)
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)

  const { data: categories, isPending: categoriesPending } = useQuery({
    queryKey: ['filter-bar-categories'],
    // GET /categories returns a bare array (not a paginated envelope) —
    // normalize like the categories index page so the Category dimension
    // filter populates instead of failing the query with undefined data.
    queryFn: () =>
      categoriesApi
        .list({ perPage: 100 })
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? []))),
    staleTime: 5 * 60_000,
  })

  const presets = DATE_PRESETS.filter((p) => (PRESET_KEYS as readonly string[]).includes(p.key) && p.key !== 'custom')
  const activeCount = [value.source, value.salesChannel, value.marketingSource, value.paymentMethod, value.categoryId, value.location, value.customerSegment, value.deliveryOutcome, value.collectionStatus].filter(Boolean).length
  // Secondary dims live behind "More filters" — their active count badges the trigger.
  const hiddenActive = [value.collectionStatus, value.categoryId, value.marketingSource, value.paymentMethod, value.location].filter(Boolean).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="inline-flex min-h-10 flex-wrap items-center gap-1 rounded-xl bg-muted p-1 text-muted-foreground border border-border/50 sm:flex-nowrap sm:gap-0">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => set({ preset: p.key, startDate: undefined, endDate: undefined })}
              className={`rounded-lg px-3 py-1.5 min-h-8 cursor-pointer text-xs font-bold transition-all duration-200 ${
                value.preset === p.key ? 'bg-background text-foreground shadow-sm' : 'hover:bg-background/40 hover:text-foreground/90'
              }`}
            >
              {p.label}
            </button>
          ))}
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <button
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 min-h-8 cursor-pointer text-xs font-bold transition-all duration-200 ${
                  value.preset === 'custom' ? 'bg-background text-foreground shadow-sm' : 'hover:bg-background/40 hover:text-foreground/90'
                }`}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                <span>{value.preset === 'custom' && value.startDate && value.endDate ? `${value.startDate} – ${value.endDate}` : 'Custom'}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-4" align="start">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-muted-foreground">Start Date</p>
                    <CalendarComponent mode="single" selected={startDate} onSelect={setStartDate} className="rounded-md border border-border/50" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-muted-foreground">End Date</p>
                    <CalendarComponent mode="single" selected={endDate} onSelect={setEndDate} className="rounded-md border border-border/50" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 border-t pt-3 border-border/50">
                  <Button variant="outline" size="sm" onClick={() => setCustomOpen(false)} className="text-xs tap-h">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={!startDate || !endDate}
                    onClick={() => {
                      if (startDate && endDate) {
                        set({ preset: 'custom', startDate: toDhakaDateString(startDate), endDate: toDhakaDateString(endDate) })
                        setCustomOpen(false)
                      }
                    }}
                    className="text-xs tap-h"
                  >
                    Apply Range
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {activeCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="tap-h text-xs"
            onClick={() => onChange({ preset: value.preset, startDate: value.startDate, endDate: value.endDate, granularity: value.granularity })}
          >
            <X className="h-3 w-3 mr-1" /> Clear ({activeCount})
          </Button>
        ) : null}
      </div>
      <Collapsible className="flex flex-col gap-2">
        <div className="flex items-end gap-2 flex-wrap">
          <DimSelect label="Source System" value={value.source} placeholder="All sources" options={SOURCES.map((s) => ({ value: s, label: s }))} onPick={(v) => set({ source: v })} />
          <DimSelect label="Sales Channel" value={value.salesChannel} placeholder="All channels" options={SALES_CHANNELS.map((s) => ({ value: s, label: s }))} onPick={(v) => set({ salesChannel: v })} />
          <DimSelect label="Segment" value={value.customerSegment} placeholder="All segments" options={SEGMENTS.map((s) => ({ value: s, label: s }))} onPick={(v) => set({ customerSegment: v })} />
          <DimSelect label="Delivery Outcome" value={value.deliveryOutcome} placeholder="All outcomes" options={OUTCOMES.map((s) => ({ value: s, label: s }))} onPick={(v) => set({ deliveryOutcome: v })} />
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="tap-h h-10 cursor-pointer text-xs">
              More filters{hiddenActive > 0 ? ` (${hiddenActive})` : ''}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="flex items-end gap-2 flex-wrap">
          <DimSelect label="Collection" value={value.collectionStatus} placeholder="All" options={COLLECTION.map((s) => ({ value: s, label: s }))} onPick={(v) => set({ collectionStatus: v })} />
          <DimSelect
            label="Category"
            value={value.categoryId}
            placeholder="All categories"
            loading={categoriesPending && !categories}
            options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
            onPick={(v) => set({ categoryId: v })}
          />
          <FreeInput label="Marketing Source" value={value.marketingSource} onPick={(v) => set({ marketingSource: v })} placeholder="slug / utm_source" />
          <FreeInput label="Payment Method" value={value.paymentMethod} onPick={(v) => set({ paymentMethod: v })} placeholder="gateway code" />
          <FreeInput label="Location" value={value.location} onPick={(v) => set({ location: v })} placeholder="city / state / zip" />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
