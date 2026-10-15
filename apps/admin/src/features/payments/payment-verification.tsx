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
import { RecordRefundModal } from '@/features/orders/components/record-refund-modal';

/**
 * D-B: per-row remainder = collected − Σ non-rejected linked refunds
 * (Refund.sourcePaymentId links, read from the payment include).
 */
export function paymentRemainder(p: PaymentRow): number {
  const refunded = (p.sourceRefunds || [])
    .filter((r) => r.status !== 'rejected')
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  return Number(p.amount) - refunded;
}

function isPaidRow(p: PaymentRow): boolean {
  return (p.status || '').toUpperCase() === 'PAID';
}

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
  // D-B: order-number search (displayId, e.g. ORD-260818-0013). Draft edits
  // locally; Search applies it to the query. `?order=` deep-links from the
  // Refunds menu with the number prefilled.
  const initialOrder = () => {
    try {
      return new URLSearchParams(window.location.search).get('order') || '';
    } catch {
      return '';
    }
  };
  const [orderDraft, setOrderDraft] = useState(initialOrder);
  const [orderNumber, setOrderNumber] = useState(initialOrder);
  // D-B: checkbox selection of PAID rows for refund via RecordRefundModal.
  const [selected, setSelected] = useState<string[]>([]);
  const [refundOpen, setRefundOpen] = useState(false);
  const perPage = 20;

  const statusParam = stateFilter === 'all' ? undefined : stateFilter === 'pending' ? 'PENDING' : 'PAID';

  const { data, isLoading } = useQuery({
    queryKey: ['payments-all', page, gatewayCode, statusParam, orderNumber],
    queryFn: () =>
      paymentsApi.list({
        page,
        perPage,
        gatewayCode: gatewayCode || undefined,
        status: statusParam,
        orderNumber: orderNumber || undefined,
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

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  const selectedRows = rows.filter((r) => selected.includes(r.id));
  const sameOrder = new Set(selectedRows.map((r) => r.orderId)).size <= 1;
  const totalRemainder = selectedRows.reduce((s, r) => s + paymentRemainder(r), 0);
  const allHaveRemainder = selectedRows.every((r) => paymentRemainder(r) > 0);
  const canRefund = selectedRows.length > 0 && sameOrder && allHaveRemainder;
  const refundableRows = rows.filter((r) => isPaidRow(r) && paymentRemainder(r) > 0);
  const hasPendingRows = rows.some((r) => !isPaidRow(r));

  const resetPage = () => { setPage(1); setSelected([]); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label="Search order number"
          value={orderDraft}
          onChange={(e) => setOrderDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setOrderNumber(orderDraft.trim()); resetPage(); } }}
          placeholder="Search order number (e.g. ORD-260818-0013)"
          className="h-9 w-72 rounded-md border border-input bg-background px-3 text-xs"
        />
        <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => { setOrderNumber(orderDraft.trim()); resetPage(); }}>
          Search
        </Button>
        {orderNumber && (
          <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => { setOrderDraft(''); setOrderNumber(''); resetPage(); }}>
            Clear
          </Button>
        )}
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-xs font-medium"
          value={gatewayCode}
          onChange={(e) => { setGatewayCode(e.target.value); resetPage(); }}
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
              onClick={() => { setStateFilter(f); resetPage(); }}
            >
              {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : 'Verified'}
            </Button>
          ))}
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">{selectedRows.length} selected</span>
          <Button size="sm" className="h-7 text-xs" disabled={!canRefund} onClick={() => setRefundOpen(true)}>
            Refund (৳{totalRemainder})
          </Button>
          {!sameOrder && (
            <span className="text-[11px] text-muted-foreground">Select rows from a single order — refunds stay within one order.</span>
          )}
          {sameOrder && !allHaveRemainder && (
            <span className="text-[11px] text-muted-foreground">Some rows have no remaining balance.</span>
          )}
        </div>
      )}
      {hasPendingRows && (
        <p className="text-[11px] text-muted-foreground">Pending rows must be approved or failed first — only PAID rows can be refunded.</p>
      )}

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
                  <th className="px-4 py-2.5 font-medium">
                    <input
                      type="checkbox"
                      aria-label="Select all payments"
                      checked={refundableRows.length > 0 && refundableRows.every((r) => selected.includes(r.id))}
                      disabled={refundableRows.length === 0}
                      onChange={() => {
                        const ids = refundableRows.map((r) => r.id);
                        setSelected((prev) =>
                          ids.every((id) => prev.includes(id))
                            ? prev.filter((id) => !ids.includes(id))
                            : [...new Set([...prev, ...ids])],
                        );
                      }}
                    />
                  </th>
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
                  // D-B: checkbox + Refunded badge are DERIVED from the PAID
                  // state and the linked-refund remainder — pending rows stay
                  // disabled until approved/failed, spent rows stay disabled.
                  const paid = isPaidRow(p);
                  const remainder = paymentRemainder(p);
                  const fullyRefunded = paid && remainder <= 0;
                  const partiallyRefunded = paid && remainder > 0 && remainder < Number(p.amount);
                  const selectable = paid && remainder > 0;
                  const selectTitle = !paid
                    ? 'Pending rows must be approved or failed first'
                    : remainder <= 0
                      ? 'Already fully refunded'
                      : 'Select for refund';
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select payment ${p.id}`}
                          checked={selected.includes(p.id)}
                          disabled={!selectable}
                          title={selectTitle}
                          onChange={() => toggleSelect(p.id)}
                        />
                      </td>
                      <TableCellLink orderId={p.orderId} displayId={p.order?.displayId} />
                      <td className="px-4 py-2.5">
                        <PaymentLogo method={p.gatewayCode} size="sm" />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{p.account || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">৳{Number(p.amount).toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{p.transactionId || '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={statusVariant(p.status)} className="text-[10px]">{p.status}</Badge>
                          {fullyRefunded && <Badge className="text-[10px]">Refunded</Badge>}
                          {partiallyRefunded && <Badge variant="secondary" className="text-[10px]">Partially refunded</Badge>}
                        </div>
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage((p) => Math.max(1, p - 1)); setSelected([]); }}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => { setPage((p) => p + 1); setSelected([]); }}>
            Next
          </Button>
        </div>
      )}

      {refundOpen && selectedRows.length > 0 && (
        <RecordRefundModal
          key={selectedRows.map((r) => r.id).join(',')}
          orderId={selectedRows[0].orderId}
          open={refundOpen}
          onClose={() => { setRefundOpen(false); setSelected([]); }}
          initialAmount={Math.round(totalRemainder * 100) / 100}
          sourcePaymentIds={selectedRows.map((r) => r.id)}
          sourceContext={selectedRows.map((r) => ({
            id: r.id,
            gatewayCode: r.gatewayCode,
            amount: Number(r.amount),
            remainder: Math.round(paymentRemainder(r) * 100) / 100,
          }))}
        />
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
