import { createFileRoute } from '@tanstack/react-router'
import { InventorySettings } from '@/features/settings/inventory'

export const Route = createFileRoute('/_authenticated/mon/settings/inventory')({
  component: InventorySettings,
})
