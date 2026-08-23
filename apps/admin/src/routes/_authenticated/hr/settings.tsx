import { createFileRoute } from '@tanstack/react-router'
import { AttendancePage } from '@/features/hr-attendance'

export const Route = createFileRoute('/_authenticated/hr/settings')({
  component: SettingsRoute,
})

function SettingsRoute() {
  return <AttendancePage initialTab='settings' />
}