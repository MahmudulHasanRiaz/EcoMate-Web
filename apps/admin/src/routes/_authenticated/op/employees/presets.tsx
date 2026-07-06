import { createFileRoute } from '@tanstack/react-router'
import AccessPresetsPage from '@/features/access-presets'

export const Route = createFileRoute('/_authenticated/op/employees/presets')({
  component: AccessPresetsPage,
})
