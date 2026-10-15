import { createFileRoute } from '@tanstack/react-router'
import { ExchangesList } from '@/features/exchanges'
export const Route = createFileRoute('/_authenticated/op/exchanges/')({ component: ExchangesList })
