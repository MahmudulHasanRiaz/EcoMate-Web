import { createFileRoute, redirect } from '@tanstack/react-router'

// The standalone Physical Stock page duplicated the Stock page's Physical
// view with fewer features and nothing linked to it (orphan). It now
// redirects to the Stock page with the Physical view preselected.
export const Route = createFileRoute('/_authenticated/op/inventory/physical/')({
  beforeLoad: () => {
    throw redirect({ to: '/op/inventory', search: { view: 'physical' } })
  },
})
