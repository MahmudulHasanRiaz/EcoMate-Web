import { createFileRoute } from '@tanstack/react-router'
import { CmsPagesSettings } from '@/features/settings/cms-pages'

export const Route = createFileRoute('/_authenticated/mon/pages/')({
  component: CmsPagesSettings,
})
