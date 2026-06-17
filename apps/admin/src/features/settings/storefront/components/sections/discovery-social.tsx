import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { getSectionById } from '@/features/settings/storefront/lib/categories'
import type { SectionId } from '@/features/settings/storefront/lib/categories'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

const SECTION_ID: SectionId = 'discovery-social'

const sectionMeta = getSectionById(SECTION_ID)

interface Props { hook: UseStorefrontSettingsReturn }

export function DiscoverySocialSection({ hook }: Props) {
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
      {sectionMeta.fields.map(fieldKey => {
        const schema = FIELD_SCHEMAS[fieldKey]
        if (!schema) return null

        if (schema.type === 'image' || schema.type.startsWith('array-')) {
          return (
            <div key={fieldKey} className='space-y-1.5'>
              <label className='text-sm font-medium'>{schema.label}</label>
              <p className='text-xs text-muted-foreground'>{schema.hint}</p>
              <div className='border border-dashed border-border/60 rounded-md p-4 text-center text-sm text-muted-foreground'>
                {schema.type === 'image' ? 'Image picker' : 'Array editor'} — placeholder for complex editor
              </div>
            </div>
          )
        }

        return (
          <Field
            key={fieldKey}
            fieldKey={fieldKey}
            schema={schema}
            value={hook.values[fieldKey] ?? ''}
            onChange={(v) => hook.setValue(fieldKey, v as string)}
          />
        )
      })}
    </SectionShell>
  )
}
