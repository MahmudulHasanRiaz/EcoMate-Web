import { createFileRoute } from '@tanstack/react-router'
import { Warehouses } from '@/features/inventory/warehouses'

export const Route = createFileRoute('/_authenticated/op/inventory/warehouses')({
  component: Warehouses,
})
