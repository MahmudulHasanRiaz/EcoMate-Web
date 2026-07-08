import { createFileRoute } from '@tanstack/react-router'
import { InventoryDetail } from '@/features/inventory/detail'

export const Route = createFileRoute('/_authenticated/op/inventory/detail')({
  component: InventoryDetail,
})
