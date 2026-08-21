import { createFileRoute } from '@tanstack/react-router'
import { MarketingReports } from '@/features/marketing/reports'
export const Route = createFileRoute('/_authenticated/op/marketing/reports/')({ component: MarketingReports })