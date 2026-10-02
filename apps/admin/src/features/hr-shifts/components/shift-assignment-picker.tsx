import { useEffect, useRef } from 'react'
import { Clock, CalendarDays, Sliders, Check, Sparkles, AlertCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useShiftPresetsQuery } from '../hooks'
import { DAY_LABELS, DAY_NAMES, formatMinutes, type ShiftPreset } from '../api'

export type ShiftMode = 'template' | 'custom' | 'rotation'

export interface ShiftSelectionValue {
  mode: ShiftMode
  // Template mode
  presetId?: string
  templateDays: number[] // default [0, 1, 2, 3, 4]
  // Custom mode
  customStartTime: string
  customEndTime: string
  customGraceMinutes: number
  customBreakMinutes: number
  customDays: number[]
  // Day-by-day rotation mode
  rotation: Record<number, string | '__none__'> // dayOfWeek -> presetId or '__none__'
}

export const DEFAULT_SHIFT_VALUE: ShiftSelectionValue = {
  mode: 'template',
  presetId: '',
  templateDays: [0, 1, 2, 3, 4], // Sun-Thu standard workdays in BD
  customStartTime: '09:00',
  customEndTime: '18:00',
  customGraceMinutes: 10,
  customBreakMinutes: 60,
  customDays: [0, 1, 2, 3, 4],
  rotation: {
    0: '__none__',
    1: '__none__',
    2: '__none__',
    3: '__none__',
    4: '__none__',
    5: '__none__',
    6: '__none__',
  },
}

interface ShiftAssignmentPickerProps {
  value: ShiftSelectionValue
  onChange: (val: ShiftSelectionValue) => void
  disabled?: boolean
}

export function ShiftAssignmentPicker({ value, onChange, disabled }: ShiftAssignmentPickerProps) {
  const { data: presets = [], isLoading: presetsLoading } = useShiftPresetsQuery()
  const allPresets = Array.isArray(presets) ? presets : []
  const activePresets = allPresets.filter((p) => p.isActive)

  // Seed the first preset ONCE per mount, and only when this is genuinely a
  // fresh form. Previously this fired on every render (a new array identity each
  // time) and called onChange unconditionally, so merely opening the edit
  // dialog marked it dirty and Save silently assigned a shift nobody picked.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    if (!value.presetId && activePresets.length > 0) {
      seededRef.current = true
      onChange({ ...value, presetId: activePresets[0].id })
    }
    // Only the preset list should re-trigger seeding; `value` is a new object
    // on every keystroke and would otherwise re-run this effect constantly.
  }, [activePresets, onChange])

  const selectedPreset = activePresets.find((p) => p.id === value.presetId)

  const toggleTemplateDay = (day: number) => {
    if (disabled) return
    const current = new Set(value.templateDays)
    if (current.has(day)) current.delete(day)
    else current.add(day)
    onChange({ ...value, templateDays: Array.from(current).sort((a, b) => a - b) })
  }

  const toggleCustomDay = (day: number) => {
    if (disabled) return
    const current = new Set(value.customDays)
    if (current.has(day)) current.delete(day)
    else current.add(day)
    onChange({ ...value, customDays: Array.from(current).sort((a, b) => a - b) })
  }

  const handleRotationDayChange = (day: number, presetId: string) => {
    if (disabled) return
    onChange({
      ...value,
      rotation: {
        ...value.rotation,
        [day]: presetId,
      },
    })
  }

  return (
    <div className='space-y-4 rounded-xl border border-border/70 bg-card p-4 sm:p-5 shadow-2xs'>
      <div className='flex flex-col gap-1'>
        <div className='flex items-center gap-2'>
          <Clock className='size-4 text-primary' />
          <h4 className='text-sm font-semibold tracking-tight'>Shift &amp; Schedule Assignment</h4>
        </div>
        <p className='text-xs text-muted-foreground'>
          Define how working hours are tracked for attendance, punctuality, and overtime calculation.
        </p>
      </div>

      <Tabs
        value={value.mode}
        onValueChange={(m) => onChange({ ...value, mode: m as ShiftMode })}
        className='w-full'
      >
        <TabsList className='grid grid-cols-3 w-full h-9'>
          <TabsTrigger value='template' className='text-xs gap-1.5' disabled={disabled}>
            <Sparkles className='size-3.5' />
            <span>Preset Template</span>
          </TabsTrigger>
          <TabsTrigger value='custom' className='text-xs gap-1.5' disabled={disabled}>
            <Clock className='size-3.5' />
            <span>Custom Hours</span>
          </TabsTrigger>
          <TabsTrigger value='rotation' className='text-xs gap-1.5' disabled={disabled}>
            <Sliders className='size-3.5' />
            <span>Day-by-Day</span>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Preset Template */}
        <TabsContent value='template' className='space-y-4 pt-3'>
          <div className='space-y-2'>
            <Label className='text-xs font-medium'>Select Shift Template</Label>
            <Select
              value={value.presetId || ''}
              disabled={disabled || presetsLoading || activePresets.length === 0}
              onValueChange={(val) => onChange({ ...value, presetId: val })}
            >
              <SelectTrigger className='h-9'>
                <SelectValue placeholder={presetsLoading ? 'Loading shifts…' : 'Select a preset'} />
              </SelectTrigger>
              <SelectContent>
                {activePresets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium'>{p.name}</span>
                      <span className='text-muted-foreground text-xs font-mono'>
                        ({p.startTime} – {p.endTime})
                      </span>
                      <Badge variant='outline' className='text-[10px] py-0 px-1 font-mono'>
                        {formatMinutes(p.standardMinutes)}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedPreset && (
              <div className='rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2 border border-border/50'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium text-foreground'>{selectedPreset.name}:</span>
                  <span className='font-mono'>{selectedPreset.startTime} – {selectedPreset.endTime}</span>
                  {selectedPreset.overnight && (
                    <Badge variant='secondary' className='text-[10px] py-0'>Overnight</Badge>
                  )}
                </div>
                <div className='flex items-center gap-3 text-[11px]'>
                  <span>Grace: {selectedPreset.graceMinutes}m</span>
                  <span>Break: {selectedPreset.breakMinutes}m</span>
                  <span className='font-semibold text-foreground'>Standard: {formatMinutes(selectedPreset.standardMinutes)}</span>
                </div>
              </div>
            )}
          </div>

          <div className='space-y-2'>
            <Label className='text-xs font-medium'>Apply to Working Days</Label>
            <div className='flex flex-wrap gap-1.5'>
              {DAY_LABELS.map((label, day) => {
                const isSelected = value.templateDays.includes(day)
                return (
                  <button
                    key={day}
                    type='button'
                    disabled={disabled}
                    onClick={() => toggleTemplateDay(day)}
                    className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <p className='text-[11px] text-muted-foreground'>
              {value.templateDays.length === 0
                ? 'No days selected. Employee will have no active shift assigned.'
                : `Assigned to ${value.templateDays.map((d) => DAY_LABELS[d]).join(', ')} (${value.templateDays.length} days/week)`}
            </p>
          </div>
        </TabsContent>

        {/* Tab 2: Custom Hours */}
        <TabsContent value='custom' className='space-y-4 pt-3'>
          <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
            <div className='space-y-1.5'>
              <Label className='text-xs font-medium'>Start Time</Label>
              <Input
                type='time'
                value={value.customStartTime}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, customStartTime: e.target.value })}
                className='h-8 text-xs font-mono'
              />
            </div>
            <div className='space-y-1.5'>
              <Label className='text-xs font-medium'>End Time</Label>
              <Input
                type='time'
                value={value.customEndTime}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, customEndTime: e.target.value })}
                className='h-8 text-xs font-mono'
              />
            </div>
            <div className='space-y-1.5'>
              <Label className='text-xs font-medium'>Grace (mins)</Label>
              <Input
                type='number'
                min={0}
                max={120}
                value={value.customGraceMinutes}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, customGraceMinutes: Number(e.target.value) || 0 })}
                className='h-8 text-xs'
              />
            </div>
            <div className='space-y-1.5'>
              <Label className='text-xs font-medium'>Break (mins)</Label>
              <Input
                type='number'
                min={0}
                max={240}
                value={value.customBreakMinutes}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, customBreakMinutes: Number(e.target.value) || 0 })}
                className='h-8 text-xs'
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label className='text-xs font-medium'>Apply to Days</Label>
            <div className='flex flex-wrap gap-1.5'>
              {DAY_LABELS.map((label, day) => {
                const isSelected = value.customDays.includes(day)
                return (
                  <button
                    key={day}
                    type='button'
                    disabled={disabled}
                    onClick={() => toggleCustomDay(day)}
                    className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <p className='text-[11px] text-muted-foreground'>
              Will create and assign a custom shift ({value.customStartTime} – {value.customEndTime}) to {value.customDays.length} selected days.
            </p>
          </div>
        </TabsContent>

        {/* Tab 3: Day-by-Day Rotation */}
        <TabsContent value='rotation' className='space-y-3 pt-3'>
          <p className='text-xs text-muted-foreground'>
            Configure each day individually. Ideal for varying shifts or weekend rotations.
          </p>
          <div className='space-y-2 max-h-64 overflow-y-auto pr-1'>
            {DAY_NAMES.map((name, day) => {
              const currentPresetId = value.rotation[day] || '__none__'
              const preset = activePresets.find((p) => p.id === currentPresetId)
              return (
                <div
                  key={day}
                  className='flex items-center justify-between gap-3 p-2 rounded-lg border border-border/50 bg-background/50 text-xs'
                >
                  <span className='w-24 font-medium shrink-0'>{name}</span>
                  <Select
                    value={currentPresetId}
                    disabled={disabled}
                    onValueChange={(val) => handleRotationDayChange(day, val)}
                  >
                    <SelectTrigger className='h-8 text-xs flex-1'>
                      <SelectValue placeholder='No shift' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__none__'>No shift / Off day</SelectItem>
                      {activePresets.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.startTime}–{p.endTime})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className='w-16 text-right tabular-nums text-muted-foreground font-mono text-[11px] shrink-0'>
                    {preset ? formatMinutes(preset.standardMinutes) : 'Off'}
                  </span>
                </div>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
