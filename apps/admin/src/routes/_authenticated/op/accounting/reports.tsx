import { createFileRoute } from '@tanstack/react-router'
import { Reports } from '@/features/accounting/reports'
export const Route = createFileRoute('/_authenticated/op/accounting/reports')({ component: Reports })
