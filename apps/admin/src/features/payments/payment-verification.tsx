import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { paymentsApi, PaymentVerificationOrder, PaymentRow } from './api';
import { Check, X, Loader2 } from 'lucide-react';
import { PaymentLogo } from '@/components/payment-logo';

export function PaymentVerificationPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'verify' | 'all'>('verify');
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Optional per-order gateway fee (৳) recorded on the single PENDING payment
  // row at verify time (P2 §3.4). Orders with several PENDING rows must use
  // the per-row verify endpoint instead — the backend 400s with guidance.
  const [fees, setFees] = useState<Record<string, string>>({});

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders-payment-verifying'],
    queryFn: paymentsApi.listVerifying,
    refetchInterval: 15000,
  });

  const verifyMut = useMutation({
    mutationFn: ({ id, verified, note, feeAmount }: { id: string; verified: boolean; note?: string; feeAmount?: number }) =>
      paymentsApi.verify(id, verified, note, feeAmount),
    onSuccess: () => {
      toast.success('Payment verification processed');
      qc.invalidateQueries({ queryKey: ['orders-payment-verifying'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Verification failed'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Payments</h2>
        <Badge variant="outline" className="text-sm">
          {orders?.length || 0} pending
        </Badge>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <Button size="sm" variant={tab === 'verify' ? 'default' : 'ghost'} onClick={() => setTab('verify')}>
          Verify{orders?.length ? ` (${orders.length})` : ''}
        </Button>
        <Button size="sm" variant={tab === 'all' ? 'default' : 'ghost'} onClick={() => setTab('all')}>
          All Payments
        </Button>
      </div>

      {tab === 'all' ? (
        <AllPaymentsLedger />
      ) : (
        <>
      {(!orders || orders.length === 0) && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No orders awaiting payment verification
          </CardContent>
        </Card>
      )}

      {orders?.map((order: PaymentVerificationOrder) => (
        <Card key={order.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                Order #{order.displayId}
                <Badge variant="secondary" className="text-xs">
                  ৳{Number(order.total).toLocaleString()}
                </Badge>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {order.paymentProof?.screenshot && (
              <div className="rounded-md overflow-hidden border max-w-md">
                <img
                  src={order.paymentProof.screenshot}
                  alt="Payment screenshot"
                  className="w-full object-cover"
                />
              </div>
            )}
            {order.paymentProof?.transactionId && (
              <p className="text-sm">
                <span className="font-medium">Transaction ID:</span>{' '}
                <span className="font-mono text-xs">{order.paymentProof.transactionId}</span>
              </p>
            )}
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Admin notes</p>
                <Textarea
                  placeholder="Add verification note..."
                  className="text-sm h-20"
                  value={notes[order.id] || ''}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [order.id]: e.target.value }))
                  }
                />
              </div>
              <div className="w-36">
                <p className="text-xs text-muted-foreground mb-1">Gateway fee (৳)</p>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={fees[order.id] || ''}
                  onChange={(e) =>
                    setFees((prev) => ({ ...prev, [order.id]: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() =>
                  verifyMut.mutate({
                    id: order.id,
                    verified: true,
                    note: notes[order.id],
                    feeAmount: fees[order.id] === '' || fees[order.id] === undefined ? undefined : parseFloat(fees[order.id]),
                  })
                }
                disabled={verifyMut.isPending}
              >
                <Check className="h-4 w-4 mr-1" /> Verify & Confirm
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  verifyMut.mutate({
                    id: order.id,
                    verified: false,
                    note: notes[order.id],
                  })
                }
                disabled={verifyMut.isPending}
              >
                <X className="h-4 w-4 mr-1" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
        </>
      )}
    </div>
  );
}

function statusVariant(status?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = (status || '').toLowerCase();
  if (s === 'paid' || s === 'verified' || s === 'completed') return 'default';
  if (s === 'pending' || s === 'payment_pending' || s === 'payment_verifying' || s === 'partial_paid') return 'secondary';
  if (s === 'failed' || s === 'cancelled' || s === 'refunded') return 'destructive';
  return 'outline';
}

// Every recorded payment row (not just the verifying queue): advances,
// balances and gateway history staff can audit later.
function AllPaymentsLedger() {
  const [page, setPage] = useState(1);
  const [gatewayCode, setGatewayCode] = useState('');
  const [status, setStatus] = useState('');
  const perPage = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['payments-all', page, gatewayCode, status],
    queryFn: () =>
      paymentsApi.list({
        page,
        perPage,
        gatewayCode: gatewayCode || undefined,
        status: status || undefined,
      }),
  });

  const rows: PaymentRow[] = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-xs font-medium"
          value={gatewayCode}
          onChange={(e) => { setGatewayCode(e.target.value); setPage(1); }}
        >
          <option value="">All gateways</option>
          <option value="cash">Cash</option>
          <option value="bkash">bKash</option>
          <option value="nagad">Nagad</option>
          <option value="bank">Bank</option>
          <option value="card">Card</option>
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-xs font-medium"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">All statuses</option>
          <option value="PAID">Paid</option>
          <option value="PARTIAL_PAID">Partial paid</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PENDING">Pending</option>
          <option value="PAYMENT_PENDING">Payment pending</option>
          <option value="PAYMENT_VERIFYING">Verifying</option>
          <option value="REFUNDED">Refunded</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No payments found
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Gateway</th>
                  <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Verified by</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                    <TableCellLink orderId={p.orderId} displayId={p.order?.displayId} />
                    <td className="px-4 py-2.5">
                      <PaymentLogo method={p.gatewayCode} size="sm" />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">৳{Number(p.amount).toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={statusVariant(p.status)} className="text-[10px]">{p.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {p.verifier ? `${p.verifier.firstName} ${p.verifier.lastName}`.trim() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(p.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function TableCellLink({ orderId, displayId }: { orderId: string; displayId?: string }) {
  return (
    <td className="px-4 py-2.5">
      <Link
        to="/op/orders/$id"
        params={{ id: orderId }}
        className="font-mono text-xs underline underline-offset-2"
      >
        {displayId || orderId.slice(0, 8)}
      </Link>
    </td>
  );
}
