import { useState, useEffect } from 'react'
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
}

const DEFAULT_VALUES: GeneralValues = {
  app_name: '',
  app_url: '',
  default_timezone: 'Asia/Dhaka',
  default_locale: 'en',
  maintenance_mode: 'false',
  admin_email: '',
  pagination_default: '20',
}

export function GeneralSettings() {
  const [values, setValues] = useState<GeneralValues>(DEFAULT_VALUES)
  const [originalValues, setOriginalValues] = useState<GeneralValues>(DEFAULT_VALUES)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    systemSettingsApi.getAll().then(r => {
      const data = r.data as Partial<GeneralValues>
      const extracted: GeneralValues = {
        app_name: data.app_name ?? '',
        app_url: data.app_url ?? '',
        default_timezone: data.default_timezone ?? 'Asia/Dhaka',
        default_locale: data.default_locale ?? 'en',
        maintenance_mode: data.maintenance_mode ?? 'false',
        admin_email: data.admin_email ?? '',
        pagination_default: data.pagination_default ?? '20',
      }
      setValues(extracted)
      setOriginalValues(extracted)
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  }, [])

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
  }

  return (
    <div className='space-y-4'>
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

