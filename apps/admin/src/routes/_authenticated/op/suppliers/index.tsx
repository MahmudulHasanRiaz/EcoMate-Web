import { createFileRoute } from '@tanstack/react-router'
import { Suppliers } from '@/features/suppliers'

export const Route = createFileRoute('/_authenticated/op/suppliers/')({
  component: Suppliers,
})
