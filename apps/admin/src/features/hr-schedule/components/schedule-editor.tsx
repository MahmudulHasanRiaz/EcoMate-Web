import { useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useSetScheduleMutation } from '../hooks'

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface ScheduleEditorProps {
  employeeId: string
  initialDays: number[]
  initialNote?: string | null
}

export function ScheduleEditor({ employeeId, initialDays, initialNote }: ScheduleEditorProps) {
  const [days, setDays] = useState<number[]>(initialDays)
  const [note, setNote] = useState(initialNote ?? '')
  const setScheduleMut = useSetScheduleMutation(employeeId)

  useEffect(() => {
    setDays(initialDays)
  }, [initialDays])

  useEffect(() => {
    setNote(initialNote ?? '')
  }, [initialNote])

  function toggle(day: number) {
    setDays((prev) => {
      if (prev.includes(day)) return prev.filter((d) => d !== day)
      return [...prev, day].sort((a, b) => a - b)
    })
  }

  function handleSave() {
    setScheduleMut.mutate({ days, note: note.trim() || undefined })
  }

  return (
    <div className='space-y-4'>
      <div>
        <Label className='text-sm font-medium'>Select off days</Label>
        <div className='mt-2 flex flex-wrap gap-2'>
          {DAY_LABELS.map((label, day) => (
            <button
              key={day}
              type='button'
              aria-pressed={days.includes(day)}
              aria-label={DAY_NAMES[day]}
              onClick={() => toggle(day)}
              className={cn(
                'h-9 w-11 rounded-md border text-sm font-medium transition-colors',
                days.includes(day)
                  ? 'border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                  : 'border-input bg-transparent text-muted-foreground hover:bg-muted'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {days.length === 0 && (
          <p className='mt-2 text-sm text-muted-foreground'>No weekly off set</p>
        )}
      </div>

      <div className='grid gap-2'>
        <Label htmlFor='weekly-off-note'>Note</Label>
        <Input
          id='weekly-off-note'
          placeholder='Optional note about this schedule'
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className='flex justify-end'>
        <Button size='sm' onClick={handleSave} disabled={setScheduleMut.isPending}>
          {setScheduleMut.isPending ? (
            <Loader2 className='h-4 w-4 animate-spin mr-1' />
          ) : (
            <Save className='h-4 w-4 mr-1' />
          )}
          Save Schedule
        </Button>
      </div>
    </div>
  )
}