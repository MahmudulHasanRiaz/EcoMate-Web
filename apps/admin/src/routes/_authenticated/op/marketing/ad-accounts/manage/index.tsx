import { createFileRoute } from '@tanstack/react-router'
import { MarketingAdAccountsManage } from '@/features/marketing/ad-accounts-manage'
export const Route = createFileRoute('/_authenticated/op/marketing/ad-accounts/manage/')({ component: MarketingAdAccountsManage })