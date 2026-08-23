import { createFileRoute } from '@tanstack/react-router'
import { Payroll } from '@/features/payroll'

export const Route = createFileRoute('/_authenticated/hr/payroll/')({
  component: Payroll,
})