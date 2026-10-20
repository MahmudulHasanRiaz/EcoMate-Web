import { useParams } from '@tanstack/react-router'
import { OrderDetailPage } from '@/features/orders/order-detail-page'

/**
 * Exchange detail — NOT a fork of the order detail page. Exchanges ARE
 * orders (EXCHANGE kind): this route composes the SAME shared page with its
 * own back target; the exchange-specific section (type chip, old-vs-new
 * goods, settlement billing) renders inside the page when kind==='EXCHANGE'.
 */
export function ExchangeDetail() {
  const { id } = useParams({ from: '/_authenticated/op/exchanges/$id' })
  return <OrderDetailPage id={id} backTo='/op/exchanges' backLabel='Exchanges' />
}
