import { createFileRoute } from '@tanstack/react-router'
import { InventoryValuation } from '@/features/inventory/valuation'
export const Route = createFileRoute('/_authenticated/op/inventory/valuation')({ component: InventoryValuation })
