import { createFileRoute } from '@tanstack/react-router'
import { Expenses } from '@/features/expenses'

export const Route = createFileRoute('/_authenticated/op/expenses/')({
  component: Expenses,
})
