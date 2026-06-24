import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SmtpValues {
  smtp_host: string
  smtp_port: string
  smtp_user: string
  smtp_pass: string
  smtp_from_email: string
  smtp_from_name: string
}

const DEFAULT_VALUES: SmtpValues = {
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_from_email: '',
  smtp_from_name: '',
}

export function SmtpSettings() {
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['smtp-settings'],
    queryFn: () => apiClient.get<SmtpValues>('/system-settings/smtp').then(r => r.data),
    staleTime: 30_000,
  })

  const [values, setValues] = useState<SmtpValues>(DEFAULT_VALUES)
  const [originalValues, setOriginalValues] = useState<SmtpValues>(DEFAULT_VALUES)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    if (!settingsData) return
    const extracted: SmtpValues = {
      smtp_host: settingsData.smtp_host ?? '',
      smtp_port: settingsData.smtp_port ?? '587',
      smtp_user: settingsData.smtp_user ?? '',
      smtp_pass: settingsData.smtp_pass ?? '',
      smtp_from_email: settingsData.smtp_from_email ?? '',
      smtp_from_name: settingsData.smtp_from_name ?? '',
    }
    setValues(extracted)
    setOriginalValues(extracted)
  }, [settingsData])

  const setValue = (key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }

  const isDirty = Object.keys(values).some(k => values[k as keyof SmtpValues] !== originalValues[k as keyof SmtpValues])
  const dirtyKeys = Object.keys(values).filter(k => values[k as keyof SmtpValues] !== originalValues[k as keyof SmtpValues])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload: Record<string, string> = {}
      for (const key of dirtyKeys) {
        payload[key] = values[key as keyof SmtpValues]
      }
      await apiClient.put('/system-settings/smtp', payload)
      setOriginalValues({ ...values })
      toast.success('SMTP settings saved')
    } catch {
      toast.error('Failed to save SMTP settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setValues({ ...originalValues })
  }

  const handleTest = async () => {
    setIsTesting(true)
    try {
      await apiClient.post('/system-settings/smtp/test')
      toast.success('Test email sent successfully')
    } catch {
      toast.error('Failed to send test email')
    } finally {
      setIsTesting(false)
    }
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-[200px]'>
        <Loader2 className='animate-spin h-6 w-6 text-primary' />
      </div>
    )
  }

  const SMTP_FIELDS: Record<string, { label: string; type: 'text' | 'password' | 'email'; hint?: string; placeholder?: string }> = {
    smtp_host: { label: 'SMTP Host', type: 'text', placeholder: 'smtp.example.com' },
    smtp_port: { label: 'SMTP Port', type: 'text', placeholder: '587' },
    smtp_user: { label: 'Username', type: 'text', placeholder: 'user@example.com' },
    smtp_pass: { label: 'Password', type: 'password', placeholder: 'Enter password' },
    smtp_from_email: { label: 'From Email', type: 'email', placeholder: 'noreply@example.com' },
    smtp_from_name: { label: 'From Name', type: 'text', placeholder: 'EcoMate' },
  }

  return (
    <div className='space-y-6'>
      <SectionShell
        id='smtp'
        title='SMTP Settings'
        description='Configure your SMTP server for sending emails.'
        isDirty={isDirty}
        isSaving={isSaving}
        dirtyCount={dirtyKeys.length}
        lastSavedAt={null}
        onSave={handleSave}
        onReset={handleReset}
      >
        <div className='grid gap-4 md:grid-cols-2'>
          {Object.entries(SMTP_FIELDS).map(([key, schema]) => (
            <Field
              key={key}
              fieldKey={key}
              schema={schema}
              value={values[key as keyof SmtpValues]}
              onChange={(v) => setValue(key, v)}
            />
          ))}
        </div>
      </SectionShell>
      <div className='flex justify-end'>
        <Button variant='outline' onClick={handleTest} disabled={isTesting}>
          {isTesting ? 'Sending...' : 'Test Connection'}
        </Button>
      </div>
    </div>
  )
}
