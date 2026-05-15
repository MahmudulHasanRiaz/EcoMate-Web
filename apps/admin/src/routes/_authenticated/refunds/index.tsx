import { createFileRoute } from '@tanstack/react-router'
import { Refunds } from '@/features/refunds'
export const Route = createFileRoute('/_authenticated/refunds/')({ component: Refunds })
