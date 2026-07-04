# Analytics Module — Design Spec

## Overview

Build a full analytics page at `/mon/analytics` (currently a placeholder) with 7 widgets covering sales + marketing metrics. Backfill the `/dashboard/analytics` endpoint with real data.

## Performance Architecture

```
Storefront                    Backend (NestJS)                  DB (PostgreSQL)
─────────                     ────────────────                  ──────────────
Page Load ──→ POST /tracking/page-view
                     │
                     ▼
              PageViewBufferService
              ┌──────────────────┐
              │ buffer[]         │
              │ flush: 100 items │
              │    or every 5s   │
              └──────┬───────────┘
                     │ batch INSERT
                     ▼
              ┌──────────────┐    page_view (monthly-partitioned)
              │  Bulk Write  │───→ auto-purge >90d
              └──────────────┘

Admin Request
       │
       ▼
  AnalyticsController
       │
       ▼
  CacheInterceptor ←── 5min TTL (in-memory Map)
       │
       ▼
  AnalyticsService ──→ Prisma ──→ Order / Payment / PageView
                                    (with composite indexes)
```

## Data Sources

| Data | Source Table | Method | Cache TTL |
|---|---|---|---|
| Sales KPIs (revenue, orders, AOV, refund rate) | `Order`, `Payment`, `Refund` | Prisma aggregation | 5 min |
| Revenue Trend | `Payment` WHERE status = 'PAID' | GROUP BY DATE | 5 min |
| Order Status Distribution | `Order` + `OrderStatus` | Existing endpoint | 5 min |
| Payment Method Split | `Payment` | Existing endpoint | 5 min |
| Top Products | `OrderItem` + `Product` | Existing endpoint | 5 min |
| Marketing KPIs (page views, visitors) | `PageView` (new) | COUNT + DISTINCT | 15 min |
| Bounce Rate | `PageView` | Sessions with 1 page view | 15 min |
| Traffic Sources | `PageView` | GROUP BY `source` column | 15 min |
| Conversion Rate | `PageView` + `Order` | Orders / Unique visitors | 15 min |

Marketing KPIs cache 15min — doesn't need real-time. Visitor counts don't change meaningfully in 15min windows.

## New DB Model

```prisma
model PageView {
  id         String   @id @default(uuid())
  url        String
  referrer   String?
  source     String?    // pre-classified: 'facebook','google','direct','instagram','tiktok','other'
  userAgent  String?
  ip         String?
  sessionId  String?
  timestamp  DateTime @default(now())

  @@index([timestamp, sessionId])
  @@index([source, timestamp])
}
```

- `source`: Pre-classified at insert time (parse referrer → map to source). Avoids expensive GROUP BY on raw referrer text.
- Composite indexes for the two main query patterns: time-range + session, and time-range + source.

### Partitioning + Cleanup Strategy

```sql
-- Monthly range partitioning
CREATE TABLE page_view (
  id UUID NOT NULL,
  url TEXT NOT NULL,
  ...
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (timestamp);

-- Monthly partitions auto-created by pg_partman or cron
CREATE TABLE page_view_2026_07 PARTITION OF page_view
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- TTL: auto-delete data >90 days
-- Run nightly via pg_cron or NestJS scheduled task
DELETE FROM page_view WHERE timestamp < NOW() - INTERVAL '90 days';
```

Prisma doesn't support partitioning natively. Migration: raw SQL for partition setup + monthly cron to create/drop partitions + delete old data.

Alternative (simpler): no partitioning, use partial indexes + aggressive TTL (30-day data retention, weekly archive migration).

## Backend — New Endpoints

### POST /api/tracking/page-view

No direct DB insert. Feeds into `PageViewBufferService` for batch writing.

Request:
```json
{
  "url": "https://shop.com/products/shoe",
  "referrer": "https://facebook.com/...",
  "sessionId": "uuid-v4"
}
```

Server auto-adds: `userAgent` (from header), `ip` (from request), `source` (from referrer classification).

Response: `201 { ok: true }`

### GET /api/analytics/sales-kpi

Cache: 5min

Query params: `startDate`, `endDate`

Response:
```json
{
  "totalRevenue": 125000,
  "totalOrders": 342,
  "aov": 365.50,
  "refundRate": 2.1,
  "totalRefunds": 2625
}
```

### GET /api/analytics/revenue-trend

Cache: 5min

Query params: `startDate`, `endDate`

Response:
```json
{
  "data": [
    { "date": "2026-07-01", "revenue": 45000 },
    { "date": "2026-07-02", "revenue": 52000 }
  ]
}
```

### GET /api/analytics/marketing-kpi

Cache: 15min

Query params: `startDate`, `endDate`

Response:
```json
{
  "pageViews": 12500,
  "uniqueVisitors": 4200,
  "bounceRate": 34.5,
  "conversionRate": 2.4,
  "pagesPerSession": 2.8
}
```

Unique visitors via `COUNT(DISTINCT sessionId) WHERE timestamp BETWEEN` — cached 15min to avoid expensive scan.

### GET /api/analytics/traffic-sources

Cache: 15min

Query params: `startDate`, `endDate`

Response:
```json
{
  "sources": [
    { "source": "facebook", "visits": 5600, "percentage": 44.8 },
    { "source": "direct", "visits": 2500, "percentage": 20 },
    { "source": "google", "visits": 1875, "percentage": 15 },
    { "source": "instagram", "visits": 1500, "percentage": 12 },
    { "source": "other", "visits": 1025, "percentage": 8.2 }
  ]
}
```

Query: `SELECT source, COUNT(*) as visits FROM page_view WHERE timestamp BETWEEN $1 AND $2 GROUP BY source ORDER BY visits DESC`. Pre-classified `source` column makes this fast.

## Backend — Implementation Details

### PageViewBufferService (`src/tracking/page-view-buffer.service.ts`)

```ts
@Injectable()
export class PageViewBufferService {
  private buffer: PageViewEntry[] = [];
  private readonly FLUSH_INTERVAL = 5000;
  private readonly FLUSH_THRESHOLD = 100;
  private flushTimer: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
    // Graceful shutdown
    process.on('SIGTERM', () => { clearInterval(this.flushTimer); this.flushSync(); });
  }

  push(entry: PageViewEntry) {
    this.buffer.push(entry);
    if (this.buffer.length >= this.FLUSH_THRESHOLD) this.flush();
  }

  async flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    await this.prisma.pageView.createMany({ data: batch, skipDuplicates: true });
  }
}
```

Key:
- Accumulates in-memory, flushes every 5s or 100 items
- No BullMQ needed (page views are fire-and-forget, no retry required)
- Graceful shutdown flushes remaining buffer

### Traffic Source Classification (at insert time)

```ts
function classifySource(referrer: string | null): string {
  if (!referrer) return 'direct';
  const hostname = new URL(referrer).hostname;
  if (/facebook|fb\.(com|me)|\.facebook\./.test(hostname)) return 'facebook';
  if (/instagram|\.cdninstagram/.test(hostname)) return 'instagram';
  if (/google\.|goo\.gl/.test(hostname)) return 'google';
  if (/tiktok/.test(hostname)) return 'tiktok';
  return 'other';
}
```

Classified once at insert time → `source` column → fast GROUP BY.

### Analytics Module

```
src/analytics/
├── analytics.module.ts
├── analytics.controller.ts
├── analytics.service.ts
├── analytics-cache.service.ts    ← in-memory cache with TTL
```

All endpoints guarded by `@RequiresFeature('admin_analytics')` and `@Roles('superadmin', 'admin', 'manager')`.

### Cache Layer (`analytics-cache.service.ts`)

```ts
@Injectable()
export class AnalyticsCacheService {
  private store = new Map<string, { data: any; expiresAt: number }>();

  get(key: string): any | null {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: any, ttlMs: number) {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  // Keyed by endpoint + dateRange — e.g. "sales-kpi:2026-07-01:2026-07-04"
  makeKey(name: string, start?: string, end?: string): string {
    return `${name}:${start || ''}:${end || ''}`;
  }
}
```

No Redis dependency. In-memory Map is sufficient for single-instance deployment. TTL auto-evicts stale entries.

### PageView Endpoint

Add `POST /tracking/page-view` to existing `TrackingController`:

```ts
@Post('page-view')
@HttpCode(HttpStatus.CREATED)
async trackPageView(
  @Body() dto: PageViewDto,
  @Ip() ip: string,
  @Req() req: FastifyRequest | ExpressRequest,
) {
  const source = classifySource(dto.referrer);
  this.bufferService.push({
    url: dto.url,
    referrer: dto.referrer,
    source,
    userAgent: req.headers['user-agent'] || '',
    ip,
    sessionId: dto.sessionId,
    timestamp: new Date(),
  });
  return { ok: true };
}
```

Rate limited: 100 req/min/IP via `@nestjs/throttler` or simple guard.

## Storefront — Page View Tracking

### Implementation

`apps/storefront/components/PageViewTracker.tsx` — Client Component

```tsx
"use client";
import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    // Generate once, persist
    if (!sessionIdRef.current) {
      let sid = localStorage.getItem("pv_session_id");
      if (!sid) {
        sid = crypto.randomUUID();
        localStorage.setItem("pv_session_id", sid);
      }
      sessionIdRef.current = sid;
    }

    const send = () => {
      const payload = {
        url: window.location.href,
        referrer: document.referrer || "",
        sessionId: sessionIdRef.current,
      };
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/tracking/page-view", JSON.stringify(payload));
      } else {
        fetch("/api/tracking/page-view", {
          method: "POST", body: JSON.stringify(payload),
          keepalive: true, headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }
    };

    // Non-blocking — defer to idle or next tick
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(send, { timeout: 2000 });
    } else {
      setTimeout(send, 0);
    }
  }, [pathname, searchParams]);

  return null;
}
```

- Zero impact on LCP/CLS — fires after idle
- `sendBeacon` preferred (survives page unload)
- sessionId in localStorage persists across tabs/sessions

## Admin Frontend — Analytics Page

### Existing Patterns to Reuse

- **`recharts`**: Already installed — use for all charts
- **`WidgetShell`**: From `@/features/dashboard/components/WidgetShell` — consistent loading/error/retry wrapper
- **`useDateFilter`**: From `@/features/dashboard/use-date-filter.ts` — date range filter with URL search params
- **`DATE_PRESETS`**: From `@/features/dashboard/constants` — reuse preset definitions
- **Dashboard types**: `WidgetProps`, `DateRange`, `DatePresetKey` from `@/features/dashboard/types`

### File Structure

```
src/features/analytics/
├── index.tsx              → page component
├── api.ts                 → API client calls
├── types.ts               → TypeScript types
├── components/
│   ├── SalesKpiCards.tsx   → 4 KPI cards
│   ├── RevenueTrendChart.tsx
│   ├── MarketingKpiWidget.tsx
│   ├── TrafficSourcesChart.tsx
│   ├── OrderStatusPieChart.tsx
│   ├── PaymentMethodPieChart.tsx
│   └── TopProductsTable.tsx
```

### Widget Descriptions

**SalesKpiCards**: 4 cards in a row — Revenue (৳), Orders (#), AOV (৳), Conversion Rate (%). Each with trend indicator.

**RevenueTrendChart**: Line chart, recharts `LineChart`. X-axis = date, Y-axis = revenue.

**MarketingKpiWidget**: 4 stat blocks — Page Views, Unique Visitors, Bounce Rate (%), Pages/Session.

**TrafficSourcesChart**: Horizontal bar chart. recharts `BarChart` layout="vertical".

**OrderStatusPieChart**: Pie chart — existing endpoint data. Pending, Confirmed, Delivered, Refunded, etc.

**PaymentMethodPieChart**: Pie chart — bKash, Nagad, Cash, etc.

**TopProductsTable**: Table with rank, product image/name, quantity sold.

### Layout

```
┌──────────────────────────────────────────────────┐
│  Sales KPI Cards (4x)                            │
├──────────────────────┬───────────────────────────┤
│  Revenue Trend       │  Marketing KPIs           │
│  (line chart)        │  (stat blocks)            │
├──────────────────────┼───────────────────────────┤
│  Traffic Sources     │  Payment Methods          │
│  (bar chart)         │  (pie chart)              │
├──────────────────────┼───────────────────────────┤
│  Order Status        │  Top Products             │
│  (pie chart)         │  (table)                  │
└──────────────────────┴───────────────────────────┘
```

### Date Range Filter

Reuse existing `DateRange` filter from dashboard (`use-date-filter.ts`). All widgets respond to same date range.

## Route Update

Replace `routes/_authenticated/mon/analytics/index.tsx` placeholder with actual component.

## Existing Endpoint Update

Update `DashboardService.getAnalytics()` to return real data from `PageView` table instead of hardcoded zeros.

## Migration

1. Add `PageView` model → `npx prisma migrate dev --name add_page_view`
2. Run raw SQL for partition setup (optional, high-traffic only):
   ```sql
   CREATE TABLE page_view () PARTITION BY RANGE (timestamp);
   -- create first partition
   CREATE TABLE page_view_default PARTITION OF page_view DEFAULT;
   ```

## Implementation Order

1. Add `PageView` model + migration
2. Backend: `PageViewBufferService`
3. Backend: `POST /tracking/page-view` endpoint (with rate limit + source classification)
4. Backend: `AnalyticsCacheService`
5. Backend: `AnalyticsModule` with `AnalyticsService` + `AnalyticsController`
6. Storefront: `PageViewTracker` component
7. Admin: Analytics page UI (7 widgets)
8. Update existing `/dashboard/analytics` endpoint
9. Verify end-to-end
