import { createFileRoute } from '@tanstack/react-router'
import { ReservationDashboard } from '@/features/inventory/reservation-dashboard'

export const Route = createFileRoute('/_authenticated/op/inventory/physical/reservations')({
  component: ReservationDashboard,
})
