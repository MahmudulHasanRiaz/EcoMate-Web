import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/employees/departments')({
  beforeLoad: () => {
    throw redirect({ to: '/hr/employees/departments' })
  },
})