import { createFileRoute } from '@tanstack/react-router'
import AccessPresetsPage from '@/features/access-presets'

export const Route = createFileRoute('/_authenticated/hr/presets')({
  component: AccessPresetsPage,
})