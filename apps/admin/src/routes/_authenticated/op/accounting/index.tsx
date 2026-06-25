import { createFileRoute } from '@tanstack/react-router'
import { ChartOfAccounts } from '@/features/accounting/chart-of-accounts'
export const Route = createFileRoute('/_authenticated/op/accounting/')({ component: ChartOfAccounts })
