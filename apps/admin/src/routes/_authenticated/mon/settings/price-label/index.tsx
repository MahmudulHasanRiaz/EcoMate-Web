import { createFileRoute } from '@tanstack/react-router'
import { PriceLabelSettings } from '@/features/settings/price-label/price-label-settings'
export const Route = createFileRoute('/_authenticated/mon/settings/price-label/')({ component: PriceLabelSettings })
