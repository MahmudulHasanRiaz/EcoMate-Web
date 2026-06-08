import { createFileRoute } from '@tanstack/react-router'
import { Tags } from '@/features/tags'

export const Route = createFileRoute('/_authenticated/op/tags/')({
  component: Tags,
})
