import { createFileRoute } from '@tanstack/react-router'
import ExpensesAnalytics from '@/features/business-analytics/expenses'

export const Route = createFileRoute('/_authenticated/mon/analytics/expenses')({
  component: ExpensesRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view as string) || undefined,
    categoryId: (search.categoryId as string) || undefined,
  }),
})

function ExpensesRoute() {
  const search = Route.useSearch()
  return <ExpensesAnalytics initialSearch={search} />
}
