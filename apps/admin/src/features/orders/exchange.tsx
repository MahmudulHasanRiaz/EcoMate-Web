import { useParams } from '@tanstack/react-router'
import { OrderFormPage } from './create'

/**
 * Create Exchange Order — a replacement sale raised against an existing order.
 *
 * Reuses the Create Order form (`mode='exchange'`): the product section,
 * pricing and totals are identical to a new order by construction, while the
 * customer block is inherited from the original and read-only. The backend
 * settles the bill against what the customer already paid, so only the
 * difference is ever collected.
 */
export function CreateExchangeOrder() {
  const { id } = useParams({ from: '/_authenticated/op/orders_/$id/exchange' })
  return <OrderFormPage mode='exchange' orderId={id} />
}