import { createFileRoute } from '@tanstack/react-router'
import { Shipments } from '@/features/shipments'
export const Route = createFileRoute('/_authenticated/mon/shipments/')({ component: Shipments })
