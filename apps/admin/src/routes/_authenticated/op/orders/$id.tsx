import { createFileRoute } from '@tanstack/react-router'
import { OrderDetailPage } from '@/features/orders/order-detail-page'

/**
 * Thin route wrapper — the page body lives in features/orders/order-detail-page
 * so the exchange detail can compose the SAME page (no fork).
 */
export const Route = createFileRoute('/_authenticated/op/orders/$id')({
  component: OrdersRoute,
})

function OrdersRoute() {
  const { id } = Route.useParams() as { id: string }
  return <OrderDetailPage id={id} backTo='/op/orders' backLabel='Back' />
}
