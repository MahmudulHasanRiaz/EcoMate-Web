import { createFileRoute } from '@tanstack/react-router'
import { SmtpSettings } from '@/features/settings/smtp'

export const Route = createFileRoute('/_authenticated/mon/settings/smtp/')({
  component: SmtpSettings,
})
