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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Copy, RefreshCw, Clock, Activity, Loader2, Plus, Eye, EyeOff, ExternalLink,
} from 'lucide-react';
import { feedsApi } from './api';

const PLATFORM_LABELS: Record<string, string> = {
  meta: 'Meta (Facebook)',
  google: 'Google Merchant Center',
  tiktok: 'TikTok',
};

const PLATFORM_COLORS: Record<string, string> = {
  meta: 'bg-blue-500',
  google: 'bg-green-500',
  tiktok: 'bg-purple-500',
};

const PLATFORM_ORDER = ['meta', 'google', 'tiktok'];

const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api$/, '');

function getFeedUrl(token: string, platform: string): string {
  return `${API_ORIGIN}/v1/feeds/catalog/${token}/${platform}`;
}

export function FeedsPage() {
  const qc = useQueryClient();
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState<string | null>(null);

  const { data: feeds = [], isLoading } = useQuery({
    queryKey: ['feeds'],
    queryFn: feedsApi.list,
  });

  const createMut = useMutation({
    mutationFn: (platform: string) => feedsApi.create({ platform }),
    onSuccess: () => {
      toast.success('Feed created');
      qc.invalidateQueries({ queryKey: ['feeds'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to create feed');
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      feedsApi.update(id, { isActive }),
    onSuccess: () => {
      toast.success('Feed status updated');
      qc.invalidateQueries({ queryKey: ['feeds'] });
    },
    onError: () => toast.error('Failed to update feed status'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => feedsApi.update(id, data),
    onSuccess: () => {
      toast.success('Feed config updated');
      qc.invalidateQueries({ queryKey: ['feeds'] });
    },
    onError: () => toast.error('Failed to update feed config'),
  });

  const regenerateMut = useMutation({
    mutationFn: (id: string) => feedsApi.regenerateToken(id),
    onSuccess: () => {
      toast.success('Token regenerated \u2014 update your platform with the new URL');
      setConfirmRegen(null);
      qc.invalidateQueries({ queryKey: ['feeds'] });
    },
    onError: () => toast.error('Failed to regenerate token'),
  });

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['feed-logs', expandedPlatform],
    queryFn: () => feedsApi.logs(expandedPlatform ?? undefined),
    enabled: !!expandedPlatform,
  });

  const handleCreate = async (platform: string) => {
    setCreating(platform);
    try {
      await createMut.mutateAsync(platform);
    } finally {
      setCreating(null);
    }
  };

  const copyUrl = (token: string, platform: string) => {
    navigator.clipboard.writeText(getFeedUrl(token, platform));
    setCopyLabel(`${platform}-url`);
    setTimeout(() => setCopyLabel(null), 2000);
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PLATFORM_ORDER.map((platform) => {
          const feed = feeds.find((f) => f.platform === platform);
          const feedUrl = feed ? getFeedUrl(feed.secureToken, feed.platform) : null;

          if (!feed) {
            return (
              <Card key={platform}>
                <CardContent className="py-8 text-center space-y-3">
                  <p className="text-sm font-medium">{PLATFORM_LABELS[platform]}</p>
                  <p className="text-xs text-muted-foreground">Not configured</p>
                  <Button
                    size="sm"
                    onClick={() => handleCreate(platform)}
                    disabled={creating === platform}
                  >
                    {creating === platform ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Plus className="h-4 w-4 mr-1" />
                    )}
                    Create Feed
                  </Button>
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={feed.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge className={PLATFORM_COLORS[feed.platform] || 'bg-gray-500'}>
                      {PLATFORM_LABELS[feed.platform] || feed.platform}
                    </Badge>
                    <Badge variant={feed.isActive ? 'default' : 'secondary'}>
                      {feed.isActive ? 'Active' : 'Disabled'}
                    </Badge>
                  </div>
                  <Switch
                    checked={feed.isActive}
                    disabled={toggleMut.isPending}
                    onCheckedChange={(checked) =>
                      toggleMut.mutate({ id: feed.id, isActive: checked })
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-muted p-2 text-xs font-mono">
                    {showTokens[feed.platform]
                      ? feedUrl
                      : feedUrl?.replace(feed.secureToken, '\u2022\u2022\u2022\u2022' + feed.secureToken.slice(-8))}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyUrl(feed.secureToken, feed.platform)}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    {copyLabel === `${feed.platform}-url` ? 'Copied!' : 'Copy'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setShowTokens((s) => ({ ...s, [feed.platform]: !s[feed.platform] }))
                    }
                    title={showTokens[feed.platform] ? 'Hide token' : 'Show token'}
                  >
                    {showTokens[feed.platform] ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </Button>
                  <a
                    href={feedUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded p-1.5 hover:bg-muted"
                    title="Open feed"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Last fetched:{' '}
                  {feed.lastFetchedAt ? new Date(feed.lastFetchedAt).toLocaleString() : 'Never'}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs ml-2"
                    onClick={() =>
                      setExpandedPlatform(
                        expandedPlatform === feed.platform ? null : feed.platform,
                      )
                    }
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
                        onChange={(e) =>
                          updateMut.mutate({ id: feed.id, excludeOutOfStock: e.target.checked })
                        }
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
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setConfirmRegen(feed.id)}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Regenerate
                  </Button>
                </div>

                    {expandedPlatform === feed.platform && (
                  <div className="border rounded-md p-3">
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Activity className="h-3 w-3" />
                      Access Logs
                    </h4>
                    {logsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading logs...
                      </div>
                    ) : logs && logs.length > 0 ? (
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
                              <TableCell className="text-xs">
                                {new Date(log.fetchedAt).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-xs font-mono">{log.ipAddress}</TableCell>
                              <TableCell className="text-xs">
                                <Badge
                                  variant={log.statusCode === 200 ? 'default' : 'destructive'}
                                  className="text-xs"
                                >
                                  {log.statusCode}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">{log.durationMs}ms</TableCell>
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
          );
        })}
      </div>

      <Dialog open={!!confirmRegen} onOpenChange={(o) => !o && setConfirmRegen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Token?</DialogTitle>
            <DialogDescription>
              This will invalidate the current feed URL. Any platform currently using this feed
              will stop working until you update it with the new URL. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRegen(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRegen && regenerateMut.mutate(confirmRegen)}
              disabled={regenerateMut.isPending}
            >
              {regenerateMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
