import { createFileRoute } from '@tanstack/react-router'
import { StockOverview } from '@/features/inventory/overview'
export const Route = createFileRoute('/_authenticated/op/inventory/overview')({ component: StockOverview })
