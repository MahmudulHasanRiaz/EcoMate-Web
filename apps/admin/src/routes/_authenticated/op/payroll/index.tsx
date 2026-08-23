import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/payroll/')({
  beforeLoad: () => {
    throw redirect({ to: '/hr/payroll' })
  },
})