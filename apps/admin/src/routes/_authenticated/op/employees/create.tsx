import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/employees/create')({
  beforeLoad: () => {
    throw redirect({ to: '/hr/employees/create' })
  },
})