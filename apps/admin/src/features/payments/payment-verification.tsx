import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { paymentsApi, PaymentVerificationOrder, PaymentRow } from './api';
import { useAuthStore } from '@/stores/auth-store';

/** Shorten `staff:<userId>` / `customer:<id>` actor tags for display. */
function ledgerActor(p: Pick<PaymentRow, 'recordedBy' | 'submittedBy'>): string {
  const raw = p.recordedBy || p.submittedBy;
  if (!raw) return '—';
  const m = raw.match(/^(staff|customer):(.+)$/);
  return m ? `${m[1]} ${m[2].slice(0, 8)}` : raw;
}
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
// balances and gateway history staff can audit later. Task 11 adds the
// ledger columns (account + txn), a pending/verified quick filter, and
// per-row approve/reject gated on self-approval.
function AllPaymentsLedger() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.auth.user?.id);
  const [page, setPage] = useState(1);
  const [gatewayCode, setGatewayCode] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'pending' | 'verified'>('all');
  const perPage = 20;

  const statusParam = stateFilter === 'all' ? undefined : stateFilter === 'pending' ? 'PENDING' : 'PAID';

  const { data, isLoading } = useQuery({
    queryKey: ['payments-all', page, gatewayCode, statusParam],
    queryFn: () =>
      paymentsApi.list({
        page,
        perPage,
        gatewayCode: gatewayCode || undefined,
        status: statusParam,
      }),
  });

  const rowMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'PAID' | 'FAILED' }) =>
      paymentsApi.verifyRow(id, { status }),
    onSuccess: () => {
      toast.success('Payment verification processed');
      qc.invalidateQueries({ queryKey: ['payments-all'] });
      qc.invalidateQueries({ queryKey: ['orders-payment-verifying'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Verification failed'),
  });

  const rows: PaymentRow[] = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
          {(['all', 'pending', 'verified'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={stateFilter === f ? 'default' : 'ghost'}
              className="h-7 text-xs capitalize"
              onClick={() => { setStateFilter(f); setPage(1); }}
            >
              {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : 'Verified'}
            </Button>
          ))}
        </div>
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
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Gateway</th>
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Transaction ID</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Recorded by</th>
                  <th className="px-4 py-2.5 font-medium">Verified by</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const isSelf = !!me && p.recordedBy === `staff:${me}`;
                  const isPending = (p.status || '').toUpperCase() === 'PENDING';
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                      <TableCellLink orderId={p.orderId} displayId={p.order?.displayId} />
                      <td className="px-4 py-2.5">
                        <PaymentLogo method={p.gatewayCode} size="sm" />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{p.account || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">৳{Number(p.amount).toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{p.transactionId || '—'}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={statusVariant(p.status)} className="text-[10px]">{p.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                        {ledgerActor(p)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {p.verifier ? `${p.verifier.firstName} ${p.verifier.lastName}`.trim() : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(p.recordedAt || p.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        {isPending ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={isSelf || rowMut.isPending}
                                title={isSelf ? 'You recorded this entry — another approver must verify it' : 'Approve this payment'}
                                onClick={() => rowMut.mutate({ id: p.id, status: 'PAID' })}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs"
                                disabled={isSelf || rowMut.isPending}
                                title={isSelf ? 'You recorded this entry — another approver must verify it' : 'Reject this payment'}
                                onClick={() => rowMut.mutate({ id: p.id, status: 'FAILED' })}
                              >
                                Reject
                              </Button>
                            </div>
                            {isSelf && (
                              <p className="text-[11px] text-muted-foreground">
                                You recorded this entry — another approver must verify it.
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
