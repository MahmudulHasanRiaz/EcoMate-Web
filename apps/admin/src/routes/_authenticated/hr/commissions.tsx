import { createFileRoute } from '@tanstack/react-router'
import { CommissionsPage } from '@/features/commissions'

export const Route = createFileRoute('/_authenticated/hr/commissions')({
  component: CommissionsPage,
})
