import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function CommerceCheckoutSection({ hook }: Props) {
  const sectionId = 'commerce-checkout'

  const lastSavedAt = (() => {
    const t = hook.lastSavedMap.checkout_district_enabled || hook.lastSavedMap.checkout_thana_enabled
    return t || null
  })()

  return (
    <SectionShell
      id={sectionId}
      title='Checkout Configuration'
      description='Form fields and payment options available to customers.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={lastSavedAt}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='grid gap-4 md:grid-cols-2'>
        <Field fieldKey='checkout_district_enabled' schema={FIELD_SCHEMAS.checkout_district_enabled} value={hook.values.checkout_district_enabled ?? ''} onChange={v => hook.setValue('checkout_district_enabled', v as string)} />
        <Field fieldKey='checkout_thana_enabled' schema={FIELD_SCHEMAS.checkout_thana_enabled} value={hook.values.checkout_thana_enabled ?? ''} onChange={v => hook.setValue('checkout_thana_enabled', v as string)} />
        <Field fieldKey='checkout_district_required' schema={FIELD_SCHEMAS.checkout_district_required} value={hook.values.checkout_district_required ?? ''} onChange={v => hook.setValue('checkout_district_required', v as string)} />
        <Field fieldKey='checkout_thana_required' schema={FIELD_SCHEMAS.checkout_thana_required} value={hook.values.checkout_thana_required ?? ''} onChange={v => hook.setValue('checkout_thana_required', v as string)} />
      </div>
    </SectionShell>
  )
}
