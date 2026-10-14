import { createFileRoute } from '@tanstack/react-router'
import { ReturnsList } from '@/features/returns'
export const Route = createFileRoute('/_authenticated/op/returns/')({ component: ReturnsList })
