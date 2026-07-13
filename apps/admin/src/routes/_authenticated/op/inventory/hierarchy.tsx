import { createFileRoute } from '@tanstack/react-router'
import { WarehouseHierarchy } from '@/features/inventory/warehouse-hierarchy'

export const Route = createFileRoute('/_authenticated/op/inventory/hierarchy')({
  component: WarehouseHierarchy,
})
