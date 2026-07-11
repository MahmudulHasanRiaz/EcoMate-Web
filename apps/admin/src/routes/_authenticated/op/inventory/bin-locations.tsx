import { createFileRoute } from '@tanstack/react-router'
import { BinLocations } from '@/features/inventory/bin-locations'

export const Route = createFileRoute('/_authenticated/op/inventory/bin-locations')({
  component: BinLocations,
})
