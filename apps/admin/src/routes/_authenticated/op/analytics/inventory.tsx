import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/analytics/inventory')({
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view as string) || undefined,
    productId: (search.productId as string) || undefined,
    variantId: (search.variantId as string) || undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/mon/analytics/inventory', search })
  },
})
