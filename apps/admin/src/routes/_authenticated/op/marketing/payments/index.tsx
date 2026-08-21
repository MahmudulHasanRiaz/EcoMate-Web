import { createFileRoute } from '@tanstack/react-router'
import { MarketingPayments } from '@/features/marketing/payments'
export const Route = createFileRoute('/_authenticated/op/marketing/payments/')({ component: MarketingPayments })
