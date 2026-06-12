import ThankYouContent, { type PaymentStatus } from './ThankYouContent';
import { getOrderForThankYou } from '@/lib/api/orders';

export const dynamic = 'force-dynamic';

type AnyOrder = Record<string, unknown> & {
  id: string;
  displayId?: string;
  status?: { id?: string; name?: string };
  payments?: Array<{ status?: string; amount?: number | string; gatewayCode?: string }>;
  total?: number | string;
  viewToken?: string | null;
  paymentOptionType?: string | null;
  paymentStatus?: string | null;
};

function derivePaymentStatus(order: AnyOrder | null): PaymentStatus {
  if (!order) return 'pending';

  const statusName = String(order.status?.name || '').toLowerCase();
  if (statusName === 'cancelled') return 'cancelled';
  if (statusName === 'delivered' || statusName === 'shipped' || statusName === 'processing' || statusName === 'confirmed') {
    return 'paid';
  }

  // Use order.paymentStatus from backend if available
  const ps = order.paymentStatus;
  if (ps === 'PAID') return 'paid';
  if (ps === 'PARTIAL_PAID') return 'partial';
  if (ps === 'FAILED' || ps === 'CANCELLED') return 'cancelled';
  if (ps === 'UNPAID' || ps === 'PAYMENT_PENDING') return 'pending';

  // Fallback: check individual payments
  const payments = Array.isArray(order.payments) ? order.payments : [];
  const verifiedPayments = payments.filter((p) => p.status === 'PAID' || p.status === 'PENDING' || p.status === 'UNPAID');
  const paidPayments = payments.filter((p) => p.status === 'PAID');
  const failedPayments = payments.filter((p) => p.status === 'FAILED');
  const totalPaid = paidPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const orderTotal = Number(order.total || 0);

  if (paidPayments.length > 0 && totalPaid >= orderTotal) return 'paid';
  if (paidPayments.length > 0 && totalPaid < orderTotal) return 'partial';
  if (failedPayments.length > 0) return 'failed';
  return 'pending';
}

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; t?: string }>;
}) {
  const params = await searchParams;
  const orderId = typeof params.orderId === 'string' ? params.orderId : null;
  const token = typeof params.t === 'string' ? params.t : null;

  if (!orderId) {
    return (
      <ThankYouContent
        order={null}
        orderId={null}
        token={null}
        paymentStatus="pending"
        errorMessage="No order ID was provided. Please use the link from your order confirmation."
      />
    );
  }

  let order: AnyOrder | null = null;
  let paymentStatus: PaymentStatus = 'pending';
  let errorMessage: string | undefined;

  try {
    const fetched = (await getOrderForThankYou(
      orderId,
      token || undefined,
    )) as AnyOrder;
    order = fetched;
    paymentStatus = derivePaymentStatus(fetched);
  } catch (err) {
    errorMessage =
      (err as Error)?.message || 'We could not find this order.';
  }

  return (
    <ThankYouContent
      order={order}
      orderId={orderId}
      token={token}
      paymentStatus={paymentStatus}
      errorMessage={errorMessage}
    />
  );
}
