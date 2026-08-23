import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/users/presets')({
  beforeLoad: () => {
    throw redirect({ to: '/hr/presets' })
  },
})