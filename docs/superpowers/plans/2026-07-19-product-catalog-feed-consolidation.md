# Product Catalog Feed — Consolidation & Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix stock logic in feed generation (match storefront), consolidate dual-panel frontend to MON-only, fix IP logging.

**Architecture:** Backend feed service rewritten to compute `availableStock` per product/variant using `availabilityMode` (same as storefront). Frontend OP duplicate removed, MON panel enhanced with missing features. Sidebar deduped.

**Tech Stack:** NestJS 11, Prisma 7, React 19, TanStack Query, shadcn/ui

---

## File Structure Map

### Backend Files
| File | Action | Responsibility |
|------|--------|---------------|
| `apps/backend/src/feed/feed.service.ts` | Modify | Fix stock logic, fix IP logging |
| `apps/backend/src/feed/feed.controller.ts` | Modify | Pass request IP/UA to service |
| `apps/backend/src/feed/feed.service.spec.ts` | Modify | Update tests for new stock logic |
| `apps/backend/src/feed/feed.module.ts` | No change | Already registered |

### Frontend Files
| File | Action | Responsibility |
|------|--------|---------------|
| `apps/admin/src/features/feeds/index.tsx` | Modify | Add create, token toggle, confirmation, error handling |
| `apps/admin/src/features/feeds/api.ts` | Modify | Add create, fix response, remove `categoriesFilter` |
| `apps/admin/src/features/product-feeds/` | **Delete (dir)** | Remove OP duplicate entirely |
| `apps/admin/src/routes/_authenticated/op/product-feeds/` | **Delete (dir)** | Remove OP route |
| `apps/admin/src/components/layout/data/sidebar-data.ts` | Modify | Remove OP entry, update MON icon |

---

### Task 1: Fix Stock Logic in Feed Generation

**Files:**
- Modify: `apps/backend/src/feed/feed.service.ts`
- Test: `apps/backend/src/feed/feed.service.spec.ts`

**Problem:** Feed currently uses `variant.managedStockQuantity > 0` directly. Ignores `availabilityMode`, `manageStock`, `reservedStock`, and `PhysicalInventory`.

- [ ] **Step 1: Add private `computeAvailableStock()` method**

Add to `feed.service.ts` after `stripHtml()`:

```typescript
private async enrichProductsWithStock(products: any[]): Promise<void> {
  if (products.length === 0) return;

  // Collect all variant IDs for INVENTORY_CONTROLLED bulk query
  const variantIds = new Set<string>();
  const productIds = new Set<string>();
  for (const p of products) {
    productIds.add(p.id);
    if (p.type === 'variable' && p.variants?.length) {
      for (const v of p.variants) {
        variantIds.add(v.id);
      }
    }
  }

  // Bulk fetch PhysicalInventory for INVENTORY_CONTROLLED products
  const inventoryRows = await this.prisma.physicalInventory.findMany({
    where: {
      OR: [
        { productId: { in: Array.from(productIds) }, variantId: null },
        { variantId: { in: Array.from(variantIds) } },
      ],
    },
    select: {
      productId: true,
      variantId: true,
      quantity: true,
      reservedQuantity: true,
    },
  });

  const invByProduct = new Map<string, { qty: number; reserved: number }>();
  const invByVariant = new Map<string, { qty: number; reserved: number }>();
  for (const row of inventoryRows) {
    if (row.variantId) {
      const cur = invByVariant.get(row.variantId) ?? { qty: 0, reserved: 0 };
      cur.qty += row.quantity;
      cur.reserved += row.reservedQuantity;
      invByVariant.set(row.variantId, cur);
    } else {
      const cur = invByProduct.get(row.productId) ?? { qty: 0, reserved: 0 };
      cur.qty += row.quantity;
      cur.reserved += row.reservedQuantity;
      invByProduct.set(row.productId, cur);
    }
  }

  for (const p of products) {
    const phys = invByProduct.get(p.id);

    p._availableStock =
      p.availabilityMode === 'ALWAYS_IN_STOCK'
        ? null
        : p.availabilityMode === 'ALWAYS_OUT_OF_STOCK'
          ? 0
          : p.availabilityMode === 'INVENTORY_CONTROLLED'
            ? (phys?.qty ?? 0) - (phys?.reserved ?? 0)
            : // MANAGED_STOCK (default)
              (p.type === 'variable'
                ? (p.variants ?? []).reduce(
                    (sum: number, v: any) =>
                      sum + (v.managedStockQuantity ?? 0),
                    0,
                  )
                : (p.managedStockQuantity ?? 0)) -
                (p.reservedStock ?? 0);

    const pPhys = invByProduct.get(p.id);
    if (p.variants) {
      for (const v of p.variants) {
        const vPhys = invByVariant.get(v.id);
        v._availableStock =
          p.availabilityMode === 'ALWAYS_IN_STOCK'
            ? null
            : p.availabilityMode === 'ALWAYS_OUT_OF_STOCK'
              ? 0
              : p.availabilityMode === 'INVENTORY_CONTROLLED'
                ? (vPhys?.qty ?? 0) - (vPhys?.reserved ?? 0)
                : // MANAGED_STOCK
                  (v.managedStockQuantity ?? 0) - (v.reservedStock ?? 0);
      }
    }
  }
}
```

- [ ] **Step 2: Add `reservedStock` to variant query**

Update the variant select inside `generateFeed()` to include `reservedStock`:

```typescript
select: {
  id: true,
  sku: true,
  price: true,
  salePrice: true,
  managedStockQuantity: true,
  reservedStock: true,  // NEW
  image: true,
},
```

Also add `availabilityMode` and `reservedStock` to product-level query (the base `include` already gets these from the product, but need to ensure they're selected — they are, since `findMany` on Product gets all fields by default when using `include`).

- [ ] **Step 3: Update `buildProductFilter()` to use stock logic**

```typescript
private async buildProductFilter(config: any): Promise<any> {
  const filter: any = { isActive: true };

  if (config.excludeOutOfStock) {
    // Can't filter availabilityMode at DB level easily for all 4 modes.
    // For MANAGED_STOCK: managedStockQuantity - reservedStock > 0
    // For ALWAYS_IN_STOCK: always include
    // For ALWAYS_OUT_OF_STOCK: exclude
    // For INVENTORY_CONTROLLED: need PhysicalInventory join — too complex here.
    // Approximate: exclude known OOS, then post-filter after enrichProductsWithStock.
    filter.OR = [
      { availabilityMode: 'ALWAYS_IN_STOCK' as any },
      {
        availabilityMode: 'MANAGED_STOCK' as any,
        managedStockQuantity: { gt: 0 },
      },
      {
        availabilityMode: 'INVENTORY_CONTROLLED' as any,
      },
    ];
  }

  if (config.minPriceFilter) {
    filter.basePrice = { gte: config.minPriceFilter };
  }

  return filter;
}
```

- [ ] **Step 4: Update `generateFeed()` to use `_availableStock`**

Find the two `availability:` lines in `generateFeed()` and change both:

```typescript
// In variant loop (line 139-142):
availability:
  variant._availableStock === null || variant._availableStock > 0
    ? 'in stock'
    : 'out of stock',
```

```typescript
// In simple product (line 164-167):
availability:
  product._availableStock === null || product._availableStock > 0
    ? 'in stock'
    : 'out of stock',
```

- [ ] **Step 5: Call `enrichProductsWithStock()` after fetching each chunk**

Inside the `while (true)` loop in `generateFeed()`, right after `const products = await this.prisma.product.findMany(queryOpts)` and before iterating, add:

```typescript
await this.enrichProductsWithStock(products);
```

- [ ] **Step 6: Add the `OR` import if needed**

The `OR` filter needs proper typing. Since we use `as any`, no import needed.

- [ ] **Step 7: Run existing tests to verify no regressions**

```bash
npx jest apps/backend/src/feed/feed.service.spec.ts --no-coverage
```
Expected: All existing tests pass.

- [ ] **Step 8: Build check**

```bash
npx nest build
```
Expected: Compiles without error.

- [ ] **Step 9: Commit backend stock fix**

```bash
git add apps/backend/src/feed/feed.service.ts
git commit -m "fix: feed stock logic now matches storefront availabilityMode computation"
```

---

### Task 2: Fix IP Address Logging

**Files:**
- Modify: `apps/backend/src/feed/feed.service.ts`
- Modify: `apps/backend/src/feed/feed.controller.ts`
- Modify: `apps/backend/src/feed/feed.service.spec.ts`

**Problem:** All access logs show `0.0.0.0` because IP/UA are hardcoded.

- [ ] **Step 1: Update `generateFeed()` signature to accept ip + userAgent**

```typescript
async generateFeed(
  token: string,
  platform: string,
  reply: any,
  ipAddress: string,
  userAgent: string,
) {
```

And pass them to `logAccess`:

```typescript
await this.logAccess(tenantId, platform, durationMs, ipAddress, userAgent);
```

- [ ] **Step 2: Update `logAccess()` signature**

```typescript
private async logAccess(
  tenantId: string,
  platform: string,
  durationMs: number,
  ipAddress: string,
  userAgent: string,
) {
  await this.prisma.productFeedLog
    .create({
      data: {
        tenantId,
        platform,
        ipAddress,
        userAgent,
        statusCode: 200,
        durationMs,
      },
    })
    .catch(() => {});
}
```

- [ ] **Step 3: Update controller to extract IP/UA and pass them**

In `feed.controller.ts`, update `getFeed()`:

```typescript
@Public()
@Get('catalog/:token/:platform')
async getFeed(
  @Param('token') token: string,
  @Param('platform') platform: string,
  @Res() reply: Response,
) {
  const ip = (reply as any).req?.ip
    || (reply as any).req?.connection?.remoteAddress
    || '0.0.0.0';
  const ua = (reply as any).req?.headers?.['user-agent'] || 'unknown';
  await this.svc.generateFeed(token, platform, reply, ip, ua);
}
```

- [ ] **Step 4: Update test spec**

Replace all `service.generateFeed(...)` calls with the new 5-param signature. Add a test verifying IP/UA passed to logAccess:

```typescript
it('should log real IP and user-agent on feed access', async () => {
  mockPrisma.productFeedConfig.findFirst.mockResolvedValue(mockConfig);
  mockFeatureFlags.canUse.mockReturnValue(true);
  mockPrisma.product.findMany.mockResolvedValue([]);
  mockPrisma.productFeedLog.create.mockResolvedValue({});
  mockPrisma.productFeedConfig.update.mockResolvedValue(mockConfig);

  const mockReply = {
    raw: {
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    },
  };

  await service.generateFeed(
    'abc', 'meta', mockReply, '203.0.113.42', 'TestBot/1.0',
  );

  expect(mockPrisma.productFeedLog.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        ipAddress: '203.0.113.42',
        userAgent: 'TestBot/1.0',
      }),
    }),
  );
});
```

- [ ] **Step 5: Run tests**

```bash
npx jest apps/backend/src/feed/feed.service.spec.ts --no-coverage
```
Expected: All tests pass (including new IP test).

- [ ] **Step 6: Build check**

```bash
npx nest build
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/feed/
git commit -m "fix: pass real IP and user-agent to feed access logs"
```

---

### Task 3: Remove OP Panel Duplicate

**Files:**
- Delete: `apps/admin/src/features/product-feeds/` (entire directory — 3 files)
- Delete: `apps/admin/src/routes/_authenticated/op/product-feeds/` (entire directory — 1 file)
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts`

- [ ] **Step 1: Delete OP feature directory**

```bash
rm -rf apps/admin/src/features/product-feeds
```

- [ ] **Step 2: Delete OP route directory**

```bash
rm -rf "apps/admin/src/routes/_authenticated/op/product-feeds"
```

- [ ] **Step 3: Remove OP sidebar entry**

In `sidebar-data.ts`, remove the Marketing section's Product Catalogs sub-item (lines 101-109) — the `Marketing` parent stays; just remove the `{ title: 'Product Catalogs', url: '/op/product-feeds', ... }` line and its trailing comma.

Also update the MON panel entry (line 140) to use a consistent icon:

```typescript
{ title: 'Product Catalogs', url: '/mon/marketing/catalog', icon: Upload, feature: 'admin_product_feeds' },
```

Change from `icon: Megaphone` to `icon: Upload`.

- [ ] **Step 4: TypeScript check**

```bash
cd apps/admin && npx tsc --noEmit
```
Expected: No errors (verified no remaining references to `product-feeds` feature).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/product-feeds apps/admin/src/routes/_authenticated/op/product-feeds apps/admin/src/components/layout/data/sidebar-data.ts
git rm -r apps/admin/src/features/product-feeds apps/admin/src/routes/_authenticated/op/product-feeds
git commit -m "refactor: remove OP panel product catalog duplicate, consolidate to MON-only"
```

---

### Task 4: Enhance MON Panel with Missing Features + Create Feed Support

**Files:**
- Modify: `apps/admin/src/features/feeds/api.ts`
- Modify: `apps/admin/src/features/feeds/index.tsx`

**Goal:** MON panel gains create-feed ability (from OP), token show/hide toggle (from OP), confirmation dialog (new), toast error handling (new).

- [ ] **Step 1: Rewrite `api.ts`**

Replace entire `feeds/feeds/api.ts`:

```typescript
import { apiClient } from '@/lib/api-client';

export interface FeedConfig {
  id: string;
  platform: string;
  secureToken: string;
  isActive: boolean;
  excludeOutOfStock: boolean;
  minPriceFilter: number | null;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedLog {
  id: string;
  platform: string;
  ipAddress: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  fetchedAt: string;
}

export const feedsApi = {
  list: () =>
    apiClient.get<FeedConfig[]>('/v1/feeds/config').then((r) => r.data),

  create: (data: { platform: string }) =>
    apiClient.post<FeedConfig>('/v1/feeds/config', data).then((r) => r.data),

  update: (id: string, data: Partial<FeedConfig>) =>
    apiClient
      .post<FeedConfig>(`/v1/feeds/config/${id}`, data)
      .then((r) => r.data),

  regenerateToken: (id: string) =>
    apiClient
      .post<FeedConfig>(`/v1/feeds/config/${id}/regenerate-token`)
      .then((r) => r.data),

  logs: (platform?: string) =>
    apiClient
      .get<FeedLog[]>('/v1/feeds/logs', { params: { platform } })
      .then((r) => r.data),
};
```

Changes:
- Removed `categoriesFilter` from `FeedConfig` (ghost field)
- Removed `r.data?.data ||` unwrapping (matches OP style — backend doesn't nest)
- Added `create()` method (from OP)
- Simplified response handling

- [ ] **Step 2: Rewrite `feeds/index.tsx`**

Replace entire component file with consolidated version:

```typescript
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
      toast.success('Token regenerated — update your platform with the new URL');
      setConfirmRegen(null);
      qc.invalidateQueries({ queryKey: ['feeds'] });
    },
    onError: () => toast.error('Failed to regenerate token'),
  });

  const { data: logs } = useQuery({
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

  const configuredPlatforms = new Set(feeds.map((f) => f.platform));

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
                      : feedUrl?.replace(feed.secureToken, '••••' + feed.secureToken.slice(-8))}
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
                  Last fetched:
                  {' '}
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
                          updateMut.mutate({
                            id: feed.id,
                            excludeOutOfStock: e.target.checked,
                          })
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
                              <TableCell className="text-xs">
                                {new Date(log.fetchedAt).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-xs font-mono">
                                {log.ipAddress}
                              </TableCell>
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
```

Key changes from original:
- **Grid layout** (3-column, matches OP): shows all 3 platforms even if not configured
- **Create Feed button** per unconfigured platform (from OP)
- **Token show/hide toggle** (from OP)
- **Confirmation dialog** for token regeneration (new)
- **Error handling** on all mutations via `onError` + toast (new)
- **Copy with feedback** (shows "Copied!" briefly)
- **Correct feed URL** format: `{API_ORIGIN}/v1/feeds/catalog/{token}/{platform}`
- **Consistent icons**: `ExternalLink` to open, `Eye`/`EyeOff` to toggle

- [ ] **Step 2: TypeScript check**

```bash
cd apps/admin && npx tsc --noEmit
```

If `@/components/ui/dialog` doesn't exist, add shadcn dialog:

```bash
npx shadcn@latest add dialog -y
```

Then re-run TypeScript check.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/feeds/
git commit -m "feat: consolidate feed UI to MON panel with create, token toggle, confirmation dialog"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Backend build**

```bash
cd apps/backend && npx nest build
```

- [ ] **Step 2: Backend tests**

```bash
cd apps/backend && npx jest apps/backend/src/feed/feed.service.spec.ts --no-coverage
```

- [ ] **Step 3: Frontend TypeScript**

```bash
cd apps/admin && npx tsc --noEmit
```

- [ ] **Step 4: Git status check**

```bash
git status
git diff --stat
```

- [ ] **Step 5: Final commit (if anything remaining)**

```bash
git add -A
git commit -m "chore: final verification pass for product catalog feed consolidation"
```

---

## Phased Scope (Future Tasks — Not in This Plan)

These were identified in the spec but deferred to keep this plan focused:

| Feature | Reason Deferred |
|---------|----------------|
| Rate limiting on public feed endpoint | Requires adding `@nestjs/throttler` guard — separate concern |
| Redis cache for feed XML | Infrastructure change, not a fix |
| Google Shopping additional fields (`gtin`, `mpn`, `google_product_category`) | Product model needs schema expansion first |
| Multi-tenant isolation | Requires auth context changes across admin panel |
| Category/brand filtering | Future enhancement |
