import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function CommerceCheckoutSection({ hook }: Props) {
  const sectionId = 'commerce-checkout'

  const paymentModes: string[] = (() => {
    try { return JSON.parse(hook.values.checkout_payment_modes || '[]') as string[] } catch { return [] }
  })()

  const setPaymentModes = (modes: string[]) => {
    hook.setValue('checkout_payment_modes', JSON.stringify(modes))
  }

  const toggleMode = (mode: string) => {
    if (paymentModes.includes(mode)) {
      setPaymentModes(paymentModes.filter(m => m !== mode))
    } else {
      setPaymentModes([...paymentModes, mode])
    }
  }

  const lastSavedAt = (() => {
    const t = hook.lastSavedMap.checkout_district_enabled || hook.lastSavedMap.checkout_thana_enabled || hook.lastSavedMap.checkout_payment_modes
    return t || null
  })()

  const availableModes = ['cod', 'bkash', 'nagad', 'card', 'bank']

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

      <div className='space-y-3'>
        <div>
          <Label className='text-xs font-medium text-foreground/80'>Payment Modes</Label>
          <p className='text-xs text-muted-foreground mb-2'>Select which payment methods to offer at checkout.</p>
        </div>
        <div className='grid grid-cols-2 md:grid-cols-3 gap-3'>
          {availableModes.map(mode => (
            <label key={mode} className='flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors'>
              <Checkbox checked={paymentModes.includes(mode)} onCheckedChange={() => toggleMode(mode)} />
              <span className='text-sm capitalize'>{mode}</span>
            </label>
          ))}
        </div>
      </div>
    </SectionShell>
  )
}
