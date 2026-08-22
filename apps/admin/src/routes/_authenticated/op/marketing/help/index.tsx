import { createFileRoute } from '@tanstack/react-router'
import { MarketingHelp } from '@/features/marketing/help'
export const Route = createFileRoute('/_authenticated/op/marketing/help/')({ component: MarketingHelp })
