import { createFileRoute } from '@tanstack/react-router'
import { MarketingCampaignDetail } from '@/features/marketing/campaign-detail'
export const Route = createFileRoute('/_authenticated/op/marketing/campaigns/$id')()