import { createFileRoute } from '@tanstack/react-router'
import { DisplaySettings } from '@/features/settings/display-catalog'

export const Route = createFileRoute('/_authenticated/mon/settings/display/')({
  component: DisplaySettings,
})
