import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, CardHeader, CardTitle, CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Copy, RefreshCw, Clock, Activity, Loader2,
} from 'lucide-react';
import { feedsApi } from './api';

const PLATFORM_CONFIG: Record<string, { name: string; color: string }> = {
  meta: { name: 'Meta (Facebook)', color: 'bg-blue-500' },
  google: { name: 'Google Merchant', color: 'bg-green-500' },
  tiktok: { name: 'TikTok', color: 'bg-purple-500' },
};

export function FeedsPage() {
  const qc = useQueryClient();
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);

  const { data: feeds, isLoading } = useQuery({
    queryKey: ['feeds'],
    queryFn: feedsApi.list,
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      feedsApi.update(id, { isActive }),
    onSuccess: () => {
      toast.success('Feed status updated');
      qc.invalidateQueries({ queryKey: ['feeds'] });
    },
  });

  const regenerateMut = useMutation({
    mutationFn: feedsApi.regenerateToken,
    onSuccess: () => {
      toast.success('Token regenerated');
      qc.invalidateQueries({ queryKey: ['feeds'] });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => feedsApi.update(id, data),
    onSuccess: () => {
      toast.success('Feed config updated');
      qc.invalidateQueries({ queryKey: ['feeds'] });
    },
  });

  const { data: logs } = useQuery({
    queryKey: ['feed-logs', expandedPlatform],
    queryFn: () => feedsApi.logs(expandedPlatform ?? undefined),
    enabled: !!expandedPlatform,
  });

  const getFeedUrl = (token: string, platform: string) => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
    const origin = base.replace(/\/api$/, '');
    return `${origin}/v1/feeds/catalog/${token}/${platform}`;
  };

  const copyUrl = (token: string, platform: string) => {
    navigator.clipboard.writeText(getFeedUrl(token, platform));
    toast.success('Feed URL copied');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Product Catalogs</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Auto-generated product feeds for Meta, Google Merchant, and TikTok
        </p>
      </div>

      {(!feeds || feeds.length === 0) && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No feed configurations found. Run database seed to create default feeds.
          </CardContent>
        </Card>
      )}

      {feeds?.map((feed) => (
        <Card key={feed.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge className={PLATFORM_CONFIG[feed.platform]?.color || 'bg-gray-500'}>
                  {PLATFORM_CONFIG[feed.platform]?.name || feed.platform}
                </Badge>
                <Badge variant={feed.isActive ? 'default' : 'secondary'}>
                  {feed.isActive ? 'Active' : 'Disabled'}
                </Badge>
              </div>
              <Switch
                checked={feed.isActive}
                onCheckedChange={(checked) => toggleMut.mutate({ id: feed.id, isActive: checked })}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={getFeedUrl(feed.secureToken, feed.platform)}
                className="text-xs font-mono flex-1"
              />
              <Button size="sm" variant="outline" onClick={() => copyUrl(feed.secureToken, feed.platform)}>
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3 w-3" />
              Last fetched:
              {' '}
              {feed.lastFetchedAt ? new Date(feed.lastFetchedAt).toLocaleString() : 'Never'}
              <Button
                variant="ghost"
                size="sm"
                className="text-xs ml-2"
                onClick={() => setExpandedPlatform(expandedPlatform === feed.platform ? null : feed.platform)}
              >
                {expandedPlatform === feed.platform ? 'Hide Logs' : 'View Logs'}
              </Button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex gap-4 items-center">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={feed.excludeOutOfStock}
                    onChange={(e) => updateMut.mutate({ id: feed.id, excludeOutOfStock: e.target.checked })}
                    className="rounded"
                  />
                  Exclude OOS
                </label>
                <div className="flex items-center gap-2 text-sm">
                  <Label className="text-xs whitespace-nowrap">Min Price:</Label>
                  <Input
                    type="number"
                    className="w-20 h-7 text-xs"
                    placeholder="0"
                    defaultValue={feed.minPriceFilter ?? ''}
                    onBlur={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      if (val !== feed.minPriceFilter) {
                        updateMut.mutate({ id: feed.id, minPriceFilter: val });
                      }
                    }}
                  />
                </div>
              </div>
              <Button size="sm" variant="destructive" onClick={() => regenerateMut.mutate(feed.id)}>
                <RefreshCw className="h-3 w-3 mr-1" /> Regenerate Token
              </Button>
            </div>

            {expandedPlatform === feed.platform && (
              <div className="border rounded-md p-3">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Activity className="h-3 w-3" />
                  Access Logs
                </h4>
                {logs && logs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Time</TableHead>
                        <TableHead className="text-xs">IP</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.slice(0, 20).map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs">{new Date(log.fetchedAt).toLocaleString()}</TableCell>
                          <TableCell className="text-xs font-mono">{log.ipAddress}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant={log.statusCode === 200 ? 'default' : 'destructive'} className="text-xs">
                              {log.statusCode}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {log.durationMs}
                            ms
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-xs text-muted-foreground">No access logs yet</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
