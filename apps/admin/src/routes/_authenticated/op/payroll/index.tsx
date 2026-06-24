import { createFileRoute } from '@tanstack/react-router'
import { Payroll } from '@/features/payroll'

export const Route = createFileRoute('/_authenticated/op/payroll/')({
  component: Payroll,
})
