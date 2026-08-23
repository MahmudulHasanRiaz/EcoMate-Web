import { createFileRoute } from '@tanstack/react-router'
import { AttendancePage } from '@/features/hr-attendance'

export const Route = createFileRoute('/_authenticated/hr/attendance')({
  component: AttendancePage,
})