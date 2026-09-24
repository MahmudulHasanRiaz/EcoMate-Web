import { createFileRoute } from '@tanstack/react-router'
import ProductAnalyticsDetail from '@/features/business-analytics/product-detail'

export const Route = createFileRoute('/_authenticated/mon/analytics/products/$id')({
  component: ProductAnalyticsDetail,
})
