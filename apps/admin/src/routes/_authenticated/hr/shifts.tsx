import { createFileRoute } from '@tanstack/react-router'
import { ShiftsPage } from '@/features/hr-shifts'

export const Route = createFileRoute('/_authenticated/hr/shifts')({
  component: ShiftsPage,
})