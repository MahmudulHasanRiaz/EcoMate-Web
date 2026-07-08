import { createFileRoute } from '@tanstack/react-router'
import { Reports } from '@/features/inventory/reports'

export const Route = createFileRoute('/_authenticated/op/inventory/reports')({
  component: Reports,
})
