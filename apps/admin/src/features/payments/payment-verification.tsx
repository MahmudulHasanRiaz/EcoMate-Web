import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { paymentsApi, PaymentVerificationOrder } from './api';
import { Check, X, Loader2 } from 'lucide-react';

export function PaymentVerificationPage() {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders-payment-verifying'],
    queryFn: paymentsApi.listVerifying,
    refetchInterval: 15000,
  });

  const verifyMut = useMutation({
    mutationFn: ({ id, verified, note }: { id: string; verified: boolean; note?: string }) =>
      paymentsApi.verify(id, verified, note),
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
        <h2 className="text-2xl font-semibold tracking-tight">Payment Verification</h2>
        <Badge variant="outline" className="text-sm">
          {orders?.length || 0} pending
        </Badge>
      </div>

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
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() =>
                  verifyMut.mutate({
                    id: order.id,
                    verified: true,
                    note: notes[order.id],
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
    </div>
  );
}
