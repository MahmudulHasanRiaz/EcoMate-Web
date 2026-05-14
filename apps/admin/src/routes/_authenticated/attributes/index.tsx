import { createFileRoute } from '@tanstack/react-router'
import { Attributes } from '@/features/attributes'

export const Route = createFileRoute('/_authenticated/attributes/')({
  component: Attributes,
})
