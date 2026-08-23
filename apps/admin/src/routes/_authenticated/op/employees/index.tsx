import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/employees/')({
  beforeLoad: () => {
    throw redirect({ to: '/hr/employees' })
  },
})