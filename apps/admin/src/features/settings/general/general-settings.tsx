import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { systemSettingsApi } from '@/features/settings/storage-api'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface GeneralValues {
  app_name: string
  app_url: string
  default_timezone: string
  default_locale: string
  maintenance_mode: string
  admin_email: string
  pagination_default: string
  size_chart_enabled: string
  accounting_enabled: string
}

const DEFAULT_VALUES: GeneralValues = {
  app_name: '',
  app_url: '',
  default_timezone: 'Asia/Dhaka',
  default_locale: 'en',
  maintenance_mode: 'false',
  admin_email: '',
  pagination_default: '20',
  size_chart_enabled: 'false',
  accounting_enabled: 'false',
}

export function GeneralSettings() {
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data as Partial<GeneralValues>),
    staleTime: 30_000,
  })

  const [values, setValues] = useState<GeneralValues>(DEFAULT_VALUES)
  const [originalValues, setOriginalValues] = useState<GeneralValues>(DEFAULT_VALUES)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!settingsData) return
    const extracted: GeneralValues = {
      app_name: settingsData.app_name ?? '',
      app_url: settingsData.app_url ?? '',
      default_timezone: settingsData.default_timezone ?? 'Asia/Dhaka',
      default_locale: settingsData.default_locale ?? 'en',
      maintenance_mode: settingsData.maintenance_mode ?? 'false',
      admin_email: settingsData.admin_email ?? '',
      pagination_default: settingsData.pagination_default ?? '20',
      size_chart_enabled: settingsData.size_chart_enabled ?? 'false',
      accounting_enabled: settingsData.accounting_enabled ?? 'false',
    }
    setValues(extracted)
    setOriginalValues(extracted)
  }, [settingsData])

  const setValue = (key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }

  const isDirty = Object.keys(values).some(k => values[k as keyof GeneralValues] !== originalValues[k as keyof GeneralValues])
  const dirtyKeys = Object.keys(values).filter(k => values[k as keyof GeneralValues] !== originalValues[k as keyof GeneralValues])
  const lastSavedAt = null

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await Promise.all(
        dirtyKeys.map(key => systemSettingsApi.set(key, values[key as keyof GeneralValues]))
      )
      setOriginalValues({ ...values })
      toast.success('Settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setValues({ ...originalValues })
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-[200px]'>
        <Loader2 className='animate-spin h-6 w-6 text-primary' />
      </div>
    )
  }

  const GENERAL_FIELDS: Record<string, { label: string; type: 'text' | 'email' | 'textarea' | 'switch'; hint?: string; placeholder?: string }> = {
    app_name: { label: 'App Name', type: 'text', placeholder: 'EcoMate' },
    app_url: { label: 'App URL', type: 'text', placeholder: 'https://example.com' },
    default_timezone: { label: 'Default Timezone', type: 'text', placeholder: 'Asia/Dhaka' },
    default_locale: { label: 'Default Locale', type: 'text', placeholder: 'en' },
    maintenance_mode: { label: 'Maintenance Mode', type: 'switch', hint: 'Enable maintenance mode for the storefront' },
    admin_email: { label: 'Admin Email', type: 'email', placeholder: 'admin@example.com' },
    pagination_default: { label: 'Default Pagination', type: 'text', placeholder: '20' },
    size_chart_enabled: { label: 'Size Chart', type: 'switch', hint: 'Enable size chart feature on the storefront' },
    accounting_enabled: { label: 'Accounting Module', type: 'switch', hint: 'Enable double-entry accounting. When on, expenses auto-create journal entries.' },
  }

  return (
    <div className='space-y-6'>
      <SectionShell
        id='general'
        title='System Settings'
        description='General system-level configuration for your application.'
        isDirty={isDirty}
        isSaving={isSaving}
        dirtyCount={dirtyKeys.length}
        lastSavedAt={lastSavedAt}
        onSave={handleSave}
        onReset={handleReset}
      >
        <div className='grid gap-4 md:grid-cols-2'>
          {Object.entries(GENERAL_FIELDS).map(([key, schema]) => (
            <Field
              key={key}
              fieldKey={key}
              schema={schema}
              value={values[key as keyof GeneralValues]}
              onChange={(v) => setValue(key, v)}
            />
          ))}
        </div>
      </SectionShell>
    </div>
  )
}

