import { createFileRoute } from '@tanstack/react-router'
import { MarketingConnections } from '@/features/marketing/connections'
export const Route = createFileRoute('/_authenticated/op/marketing/connections/')({ component: MarketingConnections })