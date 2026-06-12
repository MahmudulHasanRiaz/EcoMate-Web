import { createFileRoute } from '@tanstack/react-router'
import { MenuSettings } from '@/features/settings/menu'

export const Route = createFileRoute('/_authenticated/mon/settings/menu/')({
  component: MenuSettings,
})
