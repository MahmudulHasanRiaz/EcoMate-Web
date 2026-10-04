import { useParams } from '@tanstack/react-router'
import { OrderFormPage } from './create'

/**
 * Edit Order — the Create Order form, pre-filled with an existing order.
 *
 * The form itself lives in `create.tsx` so the two pages cannot drift: one
 * implementation, two modes. Stock is re-reserved by the backend on save, and
 * the status gate (mirrored in `item-edit-policy.ts`) locks the line items once
 * the order has shipped.
 */
export function EditOrder() {
  const { id } = useParams({ from: '/_authenticated/op/orders_/$id/edit' })
  return <OrderFormPage mode='edit' orderId={id} />
}