import { createFileRoute } from '@tanstack/react-router'
import { ExchangeDetail } from '@/features/exchanges/detail'
export const Route = createFileRoute('/_authenticated/op/exchanges/$id')({ component: ExchangeDetail })
