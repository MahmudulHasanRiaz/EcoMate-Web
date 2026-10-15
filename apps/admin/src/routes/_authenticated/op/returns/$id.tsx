import { createFileRoute } from '@tanstack/react-router'
import { ReturnDetail } from '@/features/returns/detail'
export const Route = createFileRoute('/_authenticated/op/returns/$id')({ component: ReturnDetail })
