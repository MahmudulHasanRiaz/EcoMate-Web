import { createFileRoute } from '@tanstack/react-router'
import { MarketingFunding } from '@/features/marketing/funding'
export const Route = createFileRoute('/_authenticated/op/marketing/funding/')({ component: MarketingFunding })