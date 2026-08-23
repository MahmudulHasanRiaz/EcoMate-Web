import { createFileRoute } from '@tanstack/react-router'
import { HelpPage } from '@/features/hr-help'

export const Route = createFileRoute('/_authenticated/hr/help')({
  component: HelpPage,
})