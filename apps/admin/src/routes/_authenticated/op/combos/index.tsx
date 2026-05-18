import { createFileRoute } from '@tanstack/react-router'
import { Combos } from '@/features/combos'
export const Route = createFileRoute('/_authenticated/op/combos/')({ component: Combos })
