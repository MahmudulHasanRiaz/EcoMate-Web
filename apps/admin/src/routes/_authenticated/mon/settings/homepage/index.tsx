import { createFileRoute } from '@tanstack/react-router'
import { HomepageSettings } from '@/features/settings/homepage'

export const Route = createFileRoute('/_authenticated/mon/settings/homepage/')({
  component: HomepageSettings,
})
