import { createFileRoute } from '@tanstack/react-router'
import { PackingWorkspace } from '@/features/packing'

export const Route = createFileRoute('/_authenticated/op/packing/')({
  component: PackingWorkspace,
})
