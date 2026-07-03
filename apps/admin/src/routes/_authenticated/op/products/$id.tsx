import { createFileRoute } from '@tanstack/react-router'
import { ProductDetail } from '@/features/products/components/product-detail'

export const Route = createFileRoute('/_authenticated/op/products/$id')({
  component: ProductDetail,
})
