import { createFileRoute } from '@tanstack/react-router'
import { ExpenseCategories } from '@/features/expense-categories'

export const Route = createFileRoute('/_authenticated/op/expense-categories/')({
  component: ExpenseCategories,
})
