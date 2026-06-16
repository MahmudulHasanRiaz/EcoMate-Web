import { createFileRoute } from '@tanstack/react-router'
import { BlockedListPage } from '@/features/blocking/blocked-list'

export const Route = createFileRoute('/_authenticated/op/blocked/')({
  component: BlockedListPage,
})
