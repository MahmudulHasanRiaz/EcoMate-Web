import { createFileRoute } from '@tanstack/react-router'
import { Purchases } from '@/features/purchases'

export const Route = createFileRoute('/_authenticated/op/purchases/')({
  component: Purchases,
})
