import { createFileRoute } from '@tanstack/react-router'
import { Reconciliation } from '@/features/inventory/reconciliation'

export const Route = createFileRoute('/_authenticated/op/inventory/reconciliation')({
  component: Reconciliation,
})
