import { createFileRoute } from '@tanstack/react-router'
import { StorefrontSettings } from '@/features/settings/storefront-settings'

export const Route = createFileRoute('/_authenticated/mon/settings/storefront/')({
  component: StorefrontSettings,
})
