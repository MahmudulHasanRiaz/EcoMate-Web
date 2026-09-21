import { createFileRoute } from '@tanstack/react-router'
import ProductAnalytics from '@/features/business-analytics/products'

export const Route = createFileRoute('/_authenticated/op/analytics/products')({
  component: ProductAnalytics,
})
