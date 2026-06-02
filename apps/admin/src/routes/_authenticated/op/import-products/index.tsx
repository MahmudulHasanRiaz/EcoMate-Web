import { createFileRoute } from '@tanstack/react-router'
import { ImportProducts } from '@/features/import-products'

export const Route = createFileRoute('/_authenticated/op/import-products/')({
  component: ImportProducts,
})
