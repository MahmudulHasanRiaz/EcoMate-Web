import { createFileRoute } from '@tanstack/react-router'
import { Refunds } from '@/features/refunds'
export const Route = createFileRoute('/_authenticated/op/refunds/')({ component: Refunds })
