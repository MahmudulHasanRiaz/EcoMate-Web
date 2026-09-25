import { createFileRoute } from '@tanstack/react-router'
import ProductAnalytics from '@/features/business-analytics/products'

export const Route = createFileRoute('/_authenticated/mon/analytics/products/')({
  component: ProductAnalytics,
})
