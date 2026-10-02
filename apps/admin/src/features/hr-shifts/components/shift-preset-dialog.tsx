import { useEffect, useMemo, useState } from 'react'
import { Loader2, Save, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  useCreateShiftPresetMutation,
  useUpdateShiftPresetMutation,
} from '../hooks'
import { formatMinutes, type ShiftPreset } from '../api'

export interface ShiftFormValues {
  name: string
  code: string
  startTime: string
  endTime: string
  graceMinutes: number
  breakMinutes: number
  notes: string
}

const EMPTY: ShiftFormValues = {
  name: '',
  code: '',
  startTime: '09:00',
  endTime: '17:00',
  graceMinutes: 10,
  breakMinutes: 60,
  notes: '',
}

/**
 * Mirrors the backend's standard-minutes maths so the admin sees the
 * consequence before saving, rather than discovering it in a payslip.
 */
export function computeStandardMinutes(
  startTime: string,
  endTime: string,
  breakMinutes: number,
): { minutes: number; overnight: boolean } | null {
  const parse = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v)
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) return null
    return h * 60 + min
  }
  const s = parse(startTime)
  const e = parse(endTime)
  if (s === null || e === null || s === e) return null
  const overnight = e < s
  const span = overnight ? e + 1440 - s : e - s
  const minutes = span - breakMinutes
  if (minutes <= 0) return null
  return { minutes, overnight }
}

export function ShiftPresetDialog({
  open,
  onOpenChange,
  preset,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** null = create mode. */
  preset?: ShiftPreset | null
}) {
  const [values, setValues] = useState<ShiftFormValues>(EMPTY)
  const createMut = useCreateShiftPresetMutation()
  const updateMut = useUpdateShiftPresetMutation()

  useEffect(() => {
    if (!open) return
    setValues(
      preset
        ? {
            name: preset.name,
            code: preset.code,
            startTime: preset.startTime,
            endTime: preset.endTime,
            graceMinutes: preset.graceMinutes,
            breakMinutes: preset.breakMinutes,
            notes: preset.notes ?? '',
          }
        : EMPTY,
    )
  }, [open, preset])

  const computed = useMemo(
    () => computeStandardMinutes(values.startTime, values.endTime, values.breakMinutes),
    [values.startTime, values.endTime, values.breakMinutes],
  )

  const busy = createMut.isPending || updateMut.isPending
  const valid =
    values.name.trim().length > 0 &&
    values.code.trim().length >= 2 &&
    computed !== null

  function submit() {
    if (!valid) return
    const dto = {
      name: values.name.trim(),
      code: values.code.trim().toUpperCase(),
      startTime: values.startTime,
      endTime: values.endTime,
      graceMinutes: values.graceMinutes,
      breakMinutes: values.breakMinutes,
      notes: values.notes.trim() || undefined,
    }
    if (preset) {
      // code is immutable once assigned — it identifies the preset in reports.
      updateMut.mutate(
        { id: preset.id, dto: { ...dto, code: undefined } as never },
        { onSuccess: () => onOpenChange(false) },
      )
    } else {
      createMut.mutate(dto, { onSuccess: () => onOpenChange(false) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{preset ? 'Edit shift preset' : 'New shift preset'}</DialogTitle>
          <DialogDescription>
            A reusable working-hours template. Employees are assigned these
            per weekday.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4'>
          <div className='grid gap-2 sm:grid-cols-2'>
            <div className='grid gap-2'>
              <Label htmlFor='sp-name'>Name</Label>
              <Input
                id='sp-name'
                placeholder='General'
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='sp-code'>Code</Label>
              <Input
                id='sp-code'
                placeholder='GENERAL'
                value={values.code}
                disabled={!!preset}
                onChange={(e) => setValues((v) => ({ ...v, code: e.target.value }))}
              />
              {preset && (
                <p className='text-[11px] text-muted-foreground'>
                  The code identifies this preset in reports and cannot change.
                </p>
              )}
            </div>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-2'>
              <Label htmlFor='sp-start'>Start time</Label>
              <Input
                id='sp-start'
                type='time'
                value={values.startTime}
                onChange={(e) => setValues((v) => ({ ...v, startTime: e.target.value }))}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='sp-end'>End time</Label>
              <Input
                id='sp-end'
                type='time'
                value={values.endTime}
                onChange={(e) => setValues((v) => ({ ...v, endTime: e.target.value }))}
              />
            </div>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-2'>
              <Label htmlFor='sp-grace'>Grace period (minutes)</Label>
              <Input
                id='sp-grace'
                type='number'
                min={0}
                max={120}
                value={values.graceMinutes}
                onChange={(e) =>
                  setValues((v) => ({ ...v, graceMinutes: Number(e.target.value) }))
                }
              />
              <p className='text-[11px] text-muted-foreground'>
                Arriving within this window after the start is not late.
              </p>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='sp-break'>Standard break (minutes)</Label>
              <Input
                id='sp-break'
                type='number'
                min={0}
                max={240}
                value={values.breakMinutes}
                onChange={(e) =>
                  setValues((v) => ({ ...v, breakMinutes: Number(e.target.value) }))
                }
              />
            </div>
          </div>

          {/* The whole point of the preview: the admin sees what a day is worth
              before committing, and overtime is measured against this. */}
          <div className='rounded-lg border border-border/60 bg-surface-raised/60 p-3'>
            <p className='text-xs font-medium text-muted-foreground'>
              Scheduled working time
            </p>
            {computed ? (
              <p className='mt-1 flex items-center gap-2 text-sm font-semibold'>
                {formatMinutes(computed.minutes)}
                {computed.overnight && (
                  <Badge
                    variant='secondary'
                    className='gap-1 text-[10px] font-medium'
                  >
                    <Moon className='size-3' />
                    Overnight
                  </Badge>
                )}
              </p>
            ) : (
              <p className='mt-1 text-sm text-destructive'>
                Start and end must differ, and the break must be shorter than
                the shift.
              </p>
            )}
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='sp-notes'>Notes</Label>
            <Textarea
              id='sp-notes'
              rows={2}
              placeholder='Optional note about this shift'
              value={values.notes}
              onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy && <Loader2 className='mr-1 h-4 w-4 animate-spin' />}
            <Save className='mr-1 h-4 w-4' />
            {preset ? 'Save changes' : 'Create preset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}