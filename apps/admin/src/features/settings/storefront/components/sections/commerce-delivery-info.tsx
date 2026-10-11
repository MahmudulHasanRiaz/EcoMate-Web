import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { getSectionById } from '@/features/settings/storefront/lib/categories'
import type { SectionId } from '@/features/settings/storefront/lib/categories'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, X, ArrowUp, ArrowDown } from 'lucide-react'

const SECTION_ID: SectionId = 'commerce-delivery-info'

const sectionMeta = getSectionById(SECTION_ID)

interface Props { hook: UseStorefrontSettingsReturn }

interface DeliveryRow {
  label: string
  value: string
}

export function CommerceDeliveryInfoSection({ hook }: Props) {
  const rows: DeliveryRow[] = (() => {
    try {
      const parsed = JSON.parse(hook.values.delivery_info_rows || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()

  const setRows = (next: DeliveryRow[]) => {
    hook.setValue('delivery_info_rows', JSON.stringify(next))
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    const [row] = next.splice(i, 1)
    next.splice(j, 0, row)
    setRows(next)
  }

  const lastSavedAt = sectionMeta.fields.reduce<Date | null>((acc, key) => {
    const t = hook.lastSavedMap[key]
    return t && (!acc || t > acc) ? t : acc
  }, null)

  return (
    <SectionShell
      id={SECTION_ID}
      title={sectionMeta.title}
      description={sectionMeta.description}
      isDirty={hook.isSectionDirty(SECTION_ID)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(SECTION_ID).length}
      lastSavedAt={lastSavedAt}
      onSave={() => hook.saveSection(SECTION_ID)}
      onReset={() => hook.resetSection(SECTION_ID)}
    >
      <Field
        fieldKey='delivery_info_enabled'
        schema={FIELD_SCHEMAS.delivery_info_enabled}
        value={hook.values.delivery_info_enabled ?? ''}
        onChange={(v) => hook.setValue('delivery_info_enabled', v as string)}
      />
      <Field
        fieldKey='delivery_info_title'
        schema={FIELD_SCHEMAS.delivery_info_title}
        value={hook.values.delivery_info_title ?? ''}
        onChange={(v) => hook.setValue('delivery_info_title', v as string)}
      />
      <div className='space-y-1.5'>
        <Label className='text-sm font-medium'>Delivery Rows</Label>
        <p className='text-xs text-muted-foreground'>Label/value rows shown in the buy-box card. Empty the list to hide the card.</p>
        {rows.map((row, i) => (
          <div key={i} className='flex items-center gap-2'>
            <Input
              value={row.label || ''}
              onChange={(e) => { const next = [...rows]; next[i] = { ...next[i], label: e.target.value }; setRows(next) }}
              placeholder='Label (e.g. Inside Dhaka)'
            />
            <Input
              value={row.value || ''}
              onChange={(e) => { const next = [...rows]; next[i] = { ...next[i], value: e.target.value }; setRows(next) }}
              placeholder='Value (e.g. 1–2 business days)'
            />
            <Button variant='ghost' size='icon' disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move row ${i + 1} up`}>
              <ArrowUp className='h-4 w-4' />
            </Button>
            <Button variant='ghost' size='icon' disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move row ${i + 1} down`}>
              <ArrowDown className='h-4 w-4' />
            </Button>
            <Button variant='ghost' size='icon' className='text-destructive' onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove row ${i + 1}`}>
              <X className='h-4 w-4' />
            </Button>
          </div>
        ))}
        <Button variant='outline' size='sm' onClick={() => setRows([...rows, { label: '', value: '' }])}>
          <Plus className='h-4 w-4 mr-1' /> Add Row
        </Button>
      </div>
    </SectionShell>
  )
}
