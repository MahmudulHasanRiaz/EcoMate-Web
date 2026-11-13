import { createFileRoute } from '@tanstack/react-router'
import { StoreLocationsSettings } from '@/features/settings/store-locations'

export const Route = createFileRoute('/_authenticated/mon/settings/store-locations/')({
  component: StoreLocationsSettings,
})
