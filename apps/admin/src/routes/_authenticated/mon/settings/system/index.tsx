import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/settings/system/')({
  loader: () => {
    throw redirect({ to: '/mon/settings/general' })
  },
})
