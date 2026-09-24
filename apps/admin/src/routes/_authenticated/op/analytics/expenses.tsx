import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/analytics/expenses')({
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view as string) || undefined,
    categoryId: (search.categoryId as string) || undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/mon/analytics/expenses', search })
  },
})
