import { createFileRoute } from '@tanstack/react-router'
import { IncompleteLeads } from '@/features/orders/incomplete-leads'
export const Route = createFileRoute('/_authenticated/op/orders/incomplete-leads/')({ component: IncompleteLeads })
