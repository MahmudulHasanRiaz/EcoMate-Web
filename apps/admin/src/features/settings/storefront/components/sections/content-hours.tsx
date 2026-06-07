import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, X } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

interface DaySchedule {
  day: string; open: string; close: string
}

export function ContentHoursSection({ hook }: Props) {
  const sectionId = 'content-hours'

  const hoursDetails: DaySchedule[] = (() => {
    try { return JSON.parse(hook.values.hours_details || '[]') as DaySchedule[] } catch { return [] }
  })()

  const setHoursDetails = (details: DaySchedule[]) => {
    hook.setValue('hours_details', JSON.stringify(details))
  }

  const lastSavedAt = hook.lastSavedMap.hours_label || hook.lastSavedMap.hours_details || null

  return (
    <SectionShell
      id={sectionId}
      title='Operating Hours'
      description='Store hours displayed on support and stores pages.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={lastSavedAt}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <Field fieldKey='hours_label' schema={FIELD_SCHEMAS.hours_label} value={hook.values.hours_label ?? ''} onChange={v => hook.setValue('hours_label', v as string)} />

      <div className='space-y-3'>
        <div>
          <Label className='text-xs font-medium text-foreground/80'>Daily Schedule</Label>
          <p className='text-xs text-muted-foreground mb-2'>Set opening and closing times for each day.</p>
        </div>
        {hoursDetails.map((day, i) => (
          <div key={i} className='flex items-center gap-3 p-3 border rounded-lg bg-muted/20'>
            <Input value={day.day} onChange={e => {
              const next = [...hoursDetails]; next[i] = { ...next[i], day: e.target.value }; setHoursDetails(next)
            }} placeholder='Day name' className='w-28 h-8 text-sm' />
            <Input value={day.open} onChange={e => {
              const next = [...hoursDetails]; next[i] = { ...next[i], open: e.target.value }; setHoursDetails(next)
            }} placeholder='09:00' className='w-20 h-8 text-sm' />
            <span className='text-muted-foreground text-xs'>to</span>
            <Input value={day.close} onChange={e => {
              const next = [...hoursDetails]; next[i] = { ...next[i], close: e.target.value }; setHoursDetails(next)
            }} placeholder='18:00' className='w-20 h-8 text-sm' />
            <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0 text-destructive' onClick={() => setHoursDetails(hoursDetails.filter((_, j) => j !== i))}>
              <X className='h-4 w-4' />
            </Button>
          </div>
        ))}
        <Button variant='outline' size='sm' onClick={() => setHoursDetails([...hoursDetails, { day: '', open: '', close: '' }])}>
          <Plus className='h-4 w-4 mr-1' /> Add Day
        </Button>
      </div>
    </SectionShell>
  )
}
