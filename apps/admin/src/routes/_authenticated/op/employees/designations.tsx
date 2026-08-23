import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/employees/designations')({
  beforeLoad: () => {
    throw redirect({ to: '/hr/employees/designations' })
  },
})