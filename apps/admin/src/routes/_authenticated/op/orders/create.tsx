import { createFileRoute } from '@tanstack/react-router'
import { CreateOrder } from '@/features/orders/create'
export const Route = createFileRoute('/_authenticated/op/orders/create')({ component: CreateOrder })
