import { createFileRoute } from '@tanstack/react-router'
import { CmsPagesSettings } from '@/features/settings/cms-pages-settings'

export const Route = createFileRoute('/_authenticated/mon/settings/pages/')({
  component: CmsPagesSettings,
})
