import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { getSectionById } from '@/features/settings/storefront/lib/categories'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

const sectionMeta = getSectionById('content-about')

export function ContentAboutSection({ hook }: Props) {
  const sectionId = 'content-about'

  const lastSavedAt = sectionMeta.fields.reduce<Date | null>((acc, key) => {
    const t = hook.lastSavedMap[key]
    return t && (!acc || t > acc) ? t : acc
  }, null)

  return (
    <SectionShell
      id={sectionId}
      title={sectionMeta.title}
      description={sectionMeta.description}
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={lastSavedAt}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <Field fieldKey='about_us_text' schema={FIELD_SCHEMAS.about_us_text} value={hook.values.about_us_text ?? ''} onChange={v => hook.setValue('about_us_text', v as string)} />
      <div className='grid gap-4 md:grid-cols-2'>
        <Field fieldKey='payment_info' schema={FIELD_SCHEMAS.payment_info} value={hook.values.payment_info ?? ''} onChange={v => hook.setValue('payment_info', v as string)} />
        <Field fieldKey='shipping_info' schema={FIELD_SCHEMAS.shipping_info} value={hook.values.shipping_info ?? ''} onChange={v => hook.setValue('shipping_info', v as string)} />
      </div>
      <div className='grid gap-4 md:grid-cols-2'>
        <Field fieldKey='company_name' schema={FIELD_SCHEMAS.company_name} value={hook.values.company_name ?? ''} onChange={v => hook.setValue('company_name', v as string)} />
        <Field fieldKey='company_registration' schema={FIELD_SCHEMAS.company_registration} value={hook.values.company_registration ?? ''} onChange={v => hook.setValue('company_registration', v as string)} />
        <Field fieldKey='company_certifications' schema={FIELD_SCHEMAS.company_certifications} value={hook.values.company_certifications ?? ''} onChange={v => hook.setValue('company_certifications', v as string)} />
        <Field fieldKey='company_team_size' schema={FIELD_SCHEMAS.company_team_size} value={hook.values.company_team_size ?? ''} onChange={v => hook.setValue('company_team_size', v as string)} />
      </div>
      <Field fieldKey='company_ceo_name' schema={FIELD_SCHEMAS.company_ceo_name} value={hook.values.company_ceo_name ?? ''} onChange={v => hook.setValue('company_ceo_name', v as string)} />
    </SectionShell>
  )
}
