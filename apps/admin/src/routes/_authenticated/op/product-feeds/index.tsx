import { createFileRoute } from '@tanstack/react-router'
import { ProductFeedsPage } from '@/features/product-feeds'

export const Route = createFileRoute('/_authenticated/op/product-feeds/')({
  component: ProductFeedsPage,
})
