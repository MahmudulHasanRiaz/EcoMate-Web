import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, Check, X, Package } from 'lucide-react';
import { toast } from 'sonner';
import { DispatchResponse } from './api';

export function DuplicationReviewPage() {
  const qc = useQueryClient();
  const [resolving, setResolving] = useState<string | null>(null);

  const { data: flagged, isLoading } = useQuery({
    queryKey: ['dispatches-flagged'],
    queryFn: () => apiClient.get<DispatchResponse[]>('/dispatch/flagged').then(r => r.data),
    refetchInterval: 10000,
  });

  const resolveMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiClient.post(`/dispatch/${id}/resolve-flagged`, { action }),
    onSuccess: () => {
      toast.success('Duplicate resolved');
      qc.invalidateQueries({ queryKey: ['dispatches-flagged'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to resolve'),
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-orange-500" />
        <h2 className="text-2xl font-semibold tracking-tight">Duplication Review</h2>
        <Badge variant="outline" className="ml-2">{flagged?.length || 0} flagged</Badge>
      </div>

      {(!flagged || flagged.length === 0) && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No flagged duplicates</CardContent></Card>
      )}

      {flagged?.map((d: any) => (
        <Card key={d.id} className="border-orange-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Order #{d.order?.displayId || 'Unknown'}
                <Badge variant="secondary" className="text-xs">Consignment: {d.consignmentId}</Badge>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert variant="default" className="bg-orange-50 border-orange-200">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <AlertDescription className="text-sm text-orange-800">
                Order already has an active dispatch. Review and resolve this duplicate.
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Courier:</span> <span className="capitalize font-medium">{d.courier}</span></div>
              <div><span className="text-muted-foreground">Consignment ID:</span> <span className="font-mono text-xs">{d.consignmentId}</span></div>
              {d.trackingCode && <div><span className="text-muted-foreground">Tracking:</span> <span className="font-mono text-xs">{d.trackingCode}</span></div>}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" onClick={() => resolveMut.mutate({ id: d.id, action: 'accept' })} disabled={resolveMut.isPending}>
                <Check className="h-4 w-4 mr-1" /> Accept (Product Split)
              </Button>
              <Button size="sm" variant="secondary" onClick={() => resolveMut.mutate({ id: d.id, action: 'accessories' })} disabled={resolveMut.isPending}>
                <Package className="h-4 w-4 mr-1" /> Accessories Reshipment
              </Button>
              <Button size="sm" variant="destructive" onClick={() => resolveMut.mutate({ id: d.id, action: 'cancel' })} disabled={resolveMut.isPending}>
                <X className="h-4 w-4 mr-1" /> Cancel Duplicate
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
