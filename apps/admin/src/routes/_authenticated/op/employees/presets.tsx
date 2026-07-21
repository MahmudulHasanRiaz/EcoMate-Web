import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/employees/presets')({
  beforeLoad: () => {
    throw redirect({ to: '/mon/users/presets' })
  },
})
