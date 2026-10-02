import { Loader2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useClearRotationDayMutation,
  useSetRotationDayMutation,
  useShiftPresetsQuery,
  useShiftRotationQuery,
} from '../hooks'
import { DAY_LABELS, DAY_NAMES, formatMinutes } from '../api'

const NONE = '__none__'

/**
 * Per-weekday shift assignment. Multi-assignable: Monday–Friday can all sit on
 * one preset while Saturday takes a different one, which is what most retail
 * and support teams actually run.
 */
export function RotationEditor({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError } = useShiftRotationQuery(employeeId)
  const { data: presets } = useShiftPresetsQuery()
  const setMut = useSetRotationDayMutation(employeeId)
  const clearMut = useClearRotationDayMutation(employeeId)

  if (isLoading) {
    return (
      <div className='flex justify-center py-8'>
        <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
      </div>
    )
  }

  if (isError) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        Could not load the shift rotation.
      </p>
    )
  }

  const byDay = new Map((data?.rotation ?? []).map((r) => [r.dayOfWeek, r.shift.id]))
  const assignable = (presets ?? []).filter((p) => p.isActive)

  return (
    <div className='space-y-2'>
      {DAY_LABELS.map((label, day) => {
        const current = byDay.get(day) ?? NONE
        const preset = assignable.find((p) => p.id === current)
        const busy = setMut.isPending || clearMut.isPending
        return (
          <div
            key={day}
            className='flex items-center gap-3 rounded-md border border-border/50 px-3 py-2'
          >
            <span className='w-9 shrink-0 text-sm font-medium'>{label}</span>
            <div className='min-w-0 flex-1'>
              <Select
                value={current}
                disabled={busy}
                onValueChange={(v) => {
                  if (v === NONE) clearMut.mutate(day)
                  else setMut.mutate({ dayOfWeek: day, shiftPresetId: v })
                }}
              >
                <SelectTrigger
                  className='h-8'
                  aria-label={`${DAY_NAMES[day]} shift`}
                >
                  <SelectValue placeholder='No shift' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No shift</SelectItem>
                  {assignable.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.startTime}–{p.endTime})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
              {preset ? formatMinutes(preset.standardMinutes) : '—'}
            </span>
          </div>
        )
      })}
      {assignable.length === 0 && (
        <p className='pt-2 text-sm text-muted-foreground'>
          No shift presets defined yet. Create one on the Shifts page to assign
          a rotation.
        </p>
      )}
    </div>
  )
}