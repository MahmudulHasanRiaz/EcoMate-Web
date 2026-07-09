# Analytics Module — Implementation Plan
> **Superseded by:** `docs/3-DOMAINS/12-analytics.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build full analytics page at `/mon/analytics` with 7 sales + marketing widgets, lightweight page view tracking with batch DB writes, and cached aggregation queries.

**Architecture:** Storefront sends page views via `POST /tracking/page-view` → backend buffers in-memory, batch INSERTs every 5s/100 items to partitioned `PageView` table. Analytics endpoints use `CacheService` (Redis/memory) with 5-15min TTL. Existing `recharts` + `WidgetShell` for admin UI.

**Tech Stack:** NestJS, Prisma + PostgreSQL, recharts, TanStack Query, Shadcn/ui, ioredis

---

### Task 1: PageView Prisma Model + Migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` — add model after `TrackingEvent`

- [ ] **Step 1: Add PageView model to schema**

Add after line 1711 (`}` closing TrackingEvent):

```prisma
model PageView {
  id         String   @id @default(uuid())
  url        String
  referrer   String?
  source     String?
  userAgent  String?
  ip         String?
  sessionId  String?
  timestamp  DateTime @default(now())

  @@index([timestamp, sessionId])
  @@index([source, timestamp])
}
```

- [ ] **Step 2: Run migration**

```bash
cd apps/backend
npx prisma migrate dev --name add_page_view
```

Expected: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Generate Prisma client**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client`

---

### Task 2: Page View Buffer Service

**Files:**
- Create: `apps/backend/src/tracking/page-view-buffer.service.ts`

- [ ] **Step 1: Create buffer service**

```ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface PageViewEntry {
  url: string;
  referrer: string | null;
  source: string | null;
  userAgent: string;
  ip: string;
  sessionId: string | null;
  timestamp: Date;
}

@Injectable()
export class PageViewBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(PageViewBufferService.name);
  private buffer: PageViewEntry[] = [];
  private readonly FLUSH_INTERVAL = 5_000;
  private readonly FLUSH_THRESHOLD = 100;
  private flushTimer: ReturnType<typeof setInterval>;
  private flushing = false;

  constructor(private readonly prisma: PrismaService) {
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
  }

  push(entry: PageViewEntry) {
    this.buffer.push(entry);
    if (this.buffer.length >= this.FLUSH_THRESHOLD) {
      this.flush();
    }
  }

  async flush() {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer.splice(0);
    try {
      await this.prisma.pageView.createMany({ data: batch, skipDuplicates: true });
      this.logger.debug(`Flushed ${batch.length} page views`);
    } catch (err) {
      this.logger.error(`Batch insert failed: ${(err as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }

  onModuleDestroy() {
    clearInterval(this.flushTimer);
    this.flush();
  }
}
```

- [ ] **Step 2: Create barrel export**

Create `apps/backend/src/tracking/page-view-buffer.service.ts` (already done as Step 1 — no barrel needed, direct import)

---

### Task 3: Page View DTO + Controller Endpoint

**Files:**
- Create: `apps/backend/src/tracking/dto/page-view.dto.ts`
- Modify: `apps/backend/src/tracking/tracking.controller.ts` — add POST endpoint

- [ ] **Step 1: Create DTO**

```ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class PageViewDto {
  @IsString()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsOptional()
  referrer?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;
}
```

- [ ] **Step 2: Add page-view endpoint to controller**

Add after `saveContext` method:

```ts
import { Throttle } from '@nestjs/throttler';
import { PageViewDto } from './dto/page-view.dto';
import { PageViewBufferService } from './page-view-buffer.service';

export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly pageViewBuffer: PageViewBufferService,
  ) {}

  // ... existing methods ...

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 100 } })
  @Post('page-view')
  async trackPageView(
    @Body() body: PageViewDto,
    @Ip() ip: string,
    @Req() req: fastify.FastifyRequest,
  ) {
    const source = this.classifySource(body.referrer || null);
    this.pageViewBuffer.push({
      url: body.url,
      referrer: body.referrer || null,
      source,
      userAgent: (req.headers['user-agent'] as string) || '',
      ip,
      sessionId: body.sessionId || null,
      timestamp: new Date(),
    });
    return { ok: true };
  }

  private classifySource(referrer: string | null): string {
    if (!referrer) return 'direct';
    try {
      const hostname = new URL(referrer).hostname;
      if (/facebook|fb\.(com|me)|\.facebook\./.test(hostname)) return 'facebook';
      if (/instagram|\.cdninstagram/.test(hostname)) return 'instagram';
      if (/google\.|goo\.gl/.test(hostname)) return 'google';
      if (/tiktok/.test(hostname)) return 'tiktok';
      return 'other';
    } catch {
      return 'other';
    }
  }
}
```

Note: Also add `import { Ip } from '@nestjs/common';` to the existing imports.

- [ ] **Step 3: Update controller imports**

Controller file current imports:
```ts
import { Controller, Post, Body, Req } from '@nestjs/common';
```
Change to:
```ts
import { Controller, Post, Body, Req, Ip, HttpCode } from '@nestjs/common';
```

---

### Task 4: Update TrackingModule

**Files:**
- Modify: `apps/backend/src/tracking/tracking.module.ts`

- [ ] **Step 1: Register PageViewBufferService**

```ts
import { PageViewBufferService } from './page-view-buffer.service';

// Add to providers array:
providers: [
  // ... existing providers ...
  PageViewBufferService,
],
```

---

### Task 5: Analytics Module (Service + Controller)

**Files:**
- Create: `apps/backend/src/analytics/analytics.module.ts`
- Create: `apps/backend/src/analytics/analytics.service.ts`
- Create: `apps/backend/src/analytics/analytics.controller.ts`

- [ ] **Step 1: Create analytics.service.ts**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getSalesKpi(startDate?: string, endDate?: string) {
    const cacheKey = `analytics:sales-kpi:${startDate || ''}:${endDate || ''}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = this.dateFilter(startDate, endDate);
    const refundFilter = this.dateFilter(startDate, endDate, 'createdAt');

    const [orderAgg, revenueAgg, refundAgg] = await Promise.all([
      this.prisma.order.aggregate({ _count: true, _sum: { total: true }, where: { ...dateFilter } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { ...dateFilter, status: 'PAID' } }),
      this.prisma.refund.aggregate({ _sum: { amount: true }, where: { ...refundFilter, status: 'completed' } }),
    ]);

    const totalRevenue = Number(revenueAgg._sum.amount || 0);
    const totalOrders = orderAgg._count;
    const totalRefunds = Number(refundAgg._sum.amount || 0);
    const aov = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;
    const refundRate = totalRevenue > 0 ? Math.round((totalRefunds / totalRevenue) * 10000) / 100 : 0;

    const result = { totalRevenue, totalOrders, aov, refundRate, totalRefunds };
    await this.cache.set(cacheKey, result, 300_000);
    return result;
  }

  async getRevenueTrend(startDate?: string, endDate?: string) {
    const cacheKey = `analytics:revenue-trend:${startDate || ''}:${endDate || ''}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { start, end } = this.getDateRange(startDate, endDate);
    type Row = { date: string; revenue: string };
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT DATE(p."createdAt" AT TIME ZONE 'Asia/Dhaka')::text AS date,
              SUM(p.amount)::text AS revenue
       FROM "Payment" p
       WHERE p.status = 'PAID'
         AND ($1::timestamptz IS NULL OR p."createdAt" >= $1)
         AND ($2::timestamptz IS NULL OR p."createdAt" <= $2)
       GROUP BY DATE(p."createdAt" AT TIME ZONE 'Asia/Dhaka')
       ORDER BY date ASC`,
      start, end,
    );

    const result = { data: rows.map(r => ({ date: r.date, revenue: Number(r.revenue) })) };
    await this.cache.set(cacheKey, result, 300_000);
    return result;
  }

  async getMarketingKpi(startDate?: string, endDate?: string) {
    const cacheKey = `analytics:marketing-kpi:${startDate || ''}:${endDate || ''}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { start, end } = this.getDateRange(startDate, endDate);
    type CountRow = { count: string };
    type SessionsRow = { sessionId: string; cnt: string };

    const [pageViews, visitors, sessionsRaw] = await Promise.all([
      this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*)::text AS count FROM "PageView"
         WHERE ($1::timestamptz IS NULL OR "timestamp" >= $1)
           AND ($2::timestamptz IS NULL OR "timestamp" <= $2)`,
        start, end,
      ),
      this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(DISTINCT "sessionId")::text AS count FROM "PageView"
         WHERE "sessionId" IS NOT NULL
           AND ($1::timestamptz IS NULL OR "timestamp" >= $1)
           AND ($2::timestamptz IS NULL OR "timestamp" <= $2)`,
        start, end,
      ),
      this.prisma.$queryRawUnsafe<SessionsRow[]>(
        `SELECT "sessionId", COUNT(*)::text AS cnt FROM "PageView"
         WHERE "sessionId" IS NOT NULL
           AND ($1::timestamptz IS NULL OR "timestamp" >= $1)
           AND ($2::timestamptz IS NULL OR "timestamp" <= $2)
         GROUP BY "sessionId"`,
        start, end,
      ),
    ]);

    const pv = Number(pageViews[0]?.count || 0);
    const uv = Number(visitors[0]?.count || 0);
    const sessions = sessionsRaw.length;
    const bounceSessions = sessionsRaw.filter(s => Number(s.cnt) === 1).length;
    const bounceRate = sessions > 0 ? Math.round((bounceSessions / sessions) * 10000) / 100 : 0;
    const pagesPerSession = sessions > 0 ? Math.round((pv / sessions) * 100) / 100 : 0;

    const result = { pageViews: pv, uniqueVisitors: uv, bounceRate, pagesPerSession };
    await this.cache.set(cacheKey, result, 900_000);
    return result;
  }

  async getTrafficSources(startDate?: string, endDate?: string) {
    const cacheKey = `analytics:traffic-sources:${startDate || ''}:${endDate || ''}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { start, end } = this.getDateRange(startDate, endDate);
    type Row = { source: string; visits: string };
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT COALESCE("source", 'direct') AS source, COUNT(*)::text AS visits
       FROM "PageView"
       WHERE ($1::timestamptz IS NULL OR "timestamp" >= $1)
         AND ($2::timestamptz IS NULL OR "timestamp" <= $2)
       GROUP BY "source"
       ORDER BY visits DESC`,
      start, end,
    );

    const total = rows.reduce((s, r) => s + Number(r.visits), 0);
    const sources = rows.map(r => ({
      source: r.source,
      visits: Number(r.visits),
      percentage: total > 0 ? Math.round((Number(r.visits) / total) * 10000) / 100 : 0,
    }));

    const result = { sources };
    await this.cache.set(cacheKey, result, 900_000);
    return result;
  }

  private dateFilter(startDate?: string, endDate?: string, field: string = 'createdAt'): Record<string, any> {
    if (!startDate && !endDate) return {};
    const filter: Record<string, any> = {};
    if (startDate) filter[field] = { ...filter[field], gte: new Date(startDate) };
    if (endDate) {
      filter[field] = { ...filter[field], lte: endDate.includes('T') ? new Date(endDate) : new Date(endDate + 'T23:59:59.999Z') };
    }
    return filter;
  }

  private getDateRange(startDate?: string, endDate?: string) {
    return {
      start: startDate ? new Date(startDate) : null,
      end: endDate ? (endDate.includes('T') ? new Date(endDate) : new Date(endDate + 'T23:59:59.999Z')) : null,
    };
  }
}
```

- [ ] **Step 2: Create analytics.controller.ts**

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('analytics')
@RequiresFeature('admin_analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get('sales-kpi')
  async getSalesKpi(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analytics.getSalesKpi(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('revenue-trend')
  async getRevenueTrend(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analytics.getRevenueTrend(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('marketing-kpi')
  async getMarketingKpi(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analytics.getMarketingKpi(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('traffic-sources')
  async getTrafficSources(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analytics.getTrafficSources(startDate, endDate);
  }
}
```

- [ ] **Step 3: Create analytics.module.ts**

```ts
import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 4: Register AnalyticsModule in AppModule**

Edit `apps/backend/src/app.module.ts`:
- Add import: `import { AnalyticsModule } from './analytics/analytics.module';`
- Add to `imports` array: `AnalyticsModule,`

Place after `AccountingModule,` line (alphabetically after `AccountsModule`).

---

### Task 6: Storefront PageViewTracker Component

**Files:**
- Create: `apps/storefront/components/PageViewTracker.tsx`
- Modify: `apps/storefront/app/layout.tsx` — add component

- [ ] **Step 1: Create PageViewTracker**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sidRef = useRef<string>("");

  useEffect(() => {
    if (!sidRef.current) {
      let sid = localStorage.getItem("pv_sid");
      if (!sid) {
        sid = crypto.randomUUID();
        localStorage.setItem("pv_sid", sid);
      }
      sidRef.current = sid;
    }

    const url = window.location.href;
    const referrer = document.referrer || "";

    const send = () => {
      const payload = JSON.stringify({ url, referrer, sessionId: sidRef.current });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${API_URL}/tracking/page-view`, payload);
      } else {
        fetch(`${API_URL}/tracking/page-view`, {
          method: "POST", body: payload, keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }
    };

    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(send, { timeout: 2000 });
    } else {
      setTimeout(send, 0);
    }
  }, [pathname, searchParams]);

  return null;
}
```

- [ ] **Step 2: Add to root layout**

Edit `apps/storefront/app/layout.tsx`:

Add import near other imports:
```tsx
import { PageViewTracker } from "@/components/PageViewTracker";
```

Add component inside the body, after `</StorefrontConfigProvider>` closing tag (before `</WishlistProvider>` or next sibling):

```tsx
<PageViewTracker />
```

Place it right after `</StorefrontConfigProvider>` (line ~255) so it sits inside the provider tree but before toast/banner components:

```tsx
            </StorefrontConfigProvider>
            <PageViewTracker />
            <Toaster
```

---

### Task 7: Admin Analytics API + Types

**Files:**
- Create: `apps/admin/src/features/analytics/api.ts`
- Create: `apps/admin/src/features/analytics/types.ts`

- [ ] **Step 1: Create types.ts**

```ts
export interface SalesKpi {
  totalRevenue: number;
  totalOrders: number;
  aov: number;
  refundRate: number;
  totalRefunds: number;
}

export interface RevenueTrend {
  data: { date: string; revenue: number }[];
}

export interface MarketingKpi {
  pageViews: number;
  uniqueVisitors: number;
  bounceRate: number;
  pagesPerSession: number;
}

export interface TrafficSources {
  sources: { source: string; visits: number; percentage: number }[];
}

export interface StatusCount {
  status: string;
  count: number;
  totalAmount?: number;
}

export interface RevenueByMethod {
  method: string;
  revenue: number;
}

export interface TopProduct {
  id: string;
  name: string;
  image: string;
  quantity: number;
}

export interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}
```

- [ ] **Step 2: Create api.ts**

```ts
import { apiClient } from '@/lib/api-client'
import type { SalesKpi, RevenueTrend, MarketingKpi, TrafficSources, StatusCount, RevenueByMethod, TopProduct, DateRangeParams } from './types'

function qp(p: DateRangeParams): string {
  const params = new URLSearchParams()
  if (p.startDate) params.set('startDate', p.startDate)
  if (p.endDate) params.set('endDate', p.endDate)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const analyticsApi = {
  getSalesKpi: (range?: DateRangeParams) =>
    apiClient.get<SalesKpi>(`/analytics/sales-kpi${qp(range || {})}`),
  getRevenueTrend: (range?: DateRangeParams) =>
    apiClient.get<RevenueTrend>(`/analytics/revenue-trend${qp(range || {})}`),
  getMarketingKpi: (range?: DateRangeParams) =>
    apiClient.get<MarketingKpi>(`/analytics/marketing-kpi${qp(range || {})}`),
  getTrafficSources: (range?: DateRangeParams) =>
    apiClient.get<TrafficSources>(`/analytics/traffic-sources${qp(range || {})}`),
  getOrderStatusDistribution: (range?: DateRangeParams) =>
    apiClient.get<StatusCount[]>(`/dashboard/order-status-distribution${qp(range || {})}`),
  getRevenueByPayment: (range?: DateRangeParams) =>
    apiClient.get<RevenueByMethod[]>(`/dashboard/revenue-by-payment${qp(range || {})}`),
  getTopProducts: (range?: DateRangeParams) =>
    apiClient.get<TopProduct[]>(`/dashboard/top-products${qp(range || {})}`),
}
```

---

### Task 8: Analytics Page Widgets (Sales KPI + Revenue Trend + Marketing KPI)

**Files:**
- Create: `apps/admin/src/features/analytics/components/SalesKpiCards.tsx`
- Create: `apps/admin/src/features/analytics/components/RevenueTrendChart.tsx`
- Create: `apps/admin/src/features/analytics/components/MarketingKpiWidget.tsx`

- [ ] **Step 1: SalesKpiCards.tsx**

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function SalesKpiCards({ dateRange }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics-sales-kpi', dateRange],
    queryFn: () => analyticsApi.getSalesKpi(dateRange),
    refetchInterval: 300_000,
  })

  const kpi = data?.data
  const cards = [
    { label: 'Total Revenue', value: kpi ? `৳${kpi.totalRevenue.toLocaleString()}` : '-', subtext: 'Revenue from paid orders' },
    { label: 'Total Orders', value: kpi ? kpi.totalOrders.toLocaleString() : '-', subtext: 'Orders placed' },
    { label: 'AOV', value: kpi ? `৳${kpi.aov.toLocaleString()}` : '-', subtext: 'Avg order value' },
    { label: 'Refund Rate', value: kpi ? `${kpi.refundRate}%` : '-', subtext: `${kpi?.totalRefunds.toLocaleString() || 0} refunded` },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="rounded-xl border bg-card p-5">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{c.label}</p>
          <p className="text-2xl font-bold mt-1.5 text-foreground">
            {isLoading ? <span className="text-muted-foreground">...</span> : c.value}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">{c.subtext}</p>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: RevenueTrendChart.tsx**

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg border bg-card/90 backdrop-blur-md p-2.5 shadow-md border-border">
        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
        <p className="text-sm font-bold text-foreground mt-0.5">৳{Number(payload[0].value).toLocaleString()}</p>
      </div>
    )
  }
  return null
}

export function RevenueTrendChart({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-revenue-trend', dateRange],
    queryFn: () => analyticsApi.getRevenueTrend(dateRange),
    refetchInterval: 300_000,
  })

  const chartData = data?.data?.data || []

  return (
    <WidgetShell title="Revenue Trend" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(156,163,175,0.1)" />
            <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} dx={-5} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
```

- [ ] **Step 3: MarketingKpiWidget.tsx**

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function MarketingKpiWidget({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-marketing-kpi', dateRange],
    queryFn: () => analyticsApi.getMarketingKpi(dateRange),
    refetchInterval: 900_000,
  })

  const kpi = data?.data
  const stats = [
    { label: 'Page Views', value: kpi ? kpi.pageViews.toLocaleString() : '-' },
    { label: 'Unique Visitors', value: kpi ? kpi.uniqueVisitors.toLocaleString() : '-' },
    { label: 'Bounce Rate', value: kpi ? `${kpi.bounceRate}%` : '-' },
    { label: 'Pages / Session', value: kpi ? kpi.pagesPerSession.toFixed(1) : '-' },
  ]

  return (
    <WidgetShell title="Marketing KPIs" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      <div className="grid grid-cols-2 gap-4 p-2">
        {stats.map(s => (
          <div key={s.label}>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-bold text-foreground mt-0.5">
              {isLoading ? '...' : s.value}
            </p>
          </div>
        ))}
      </div>
    </WidgetShell>
  )
}
```

---

### Task 9: More Analytics Widgets (Traffic Sources + Order Status + Payment + Top Products)

**Files:**
- Create: `apps/admin/src/features/analytics/components/TrafficSourcesChart.tsx`
- Create: `apps/admin/src/features/analytics/components/OrderStatusPieChart.tsx`
- Create: `apps/admin/src/features/analytics/components/PaymentMethodPieChart.tsx`
- Create: `apps/admin/src/features/analytics/components/TopProductsTable.tsx`

- [ ] **Step 1: TrafficSourcesChart.tsx**

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function TrafficSourcesChart({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-traffic-sources', dateRange],
    queryFn: () => analyticsApi.getTrafficSources(dateRange),
    refetchInterval: 900_000,
  })

  const chartData = (data?.data?.sources || []).map(s => ({ name: s.source, visits: s.visits, pct: s.percentage }))

  return (
    <WidgetShell title="Traffic Sources" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(156,163,175,0.1)" />
              <XAxis type="number" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} width={70} />
              <Tooltip formatter={(v: number, n: string) => [v.toLocaleString(), n === 'visits' ? 'Visits' : '']} />
              <Bar dataKey="visits" fill="#3b82f6" radius={[0, 4, 4, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 space-y-1">
            {chartData.map(s => (
              <div key={s.name} className="flex justify-between text-xs px-1">
                <span className="capitalize text-muted-foreground">{s.name}</span>
                <span className="font-medium">{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </WidgetShell>
  )
}
```

- [ ] **Step 2: OrderStatusPieChart.tsx**

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

interface Props { dateRange: DateRangeParams }

export function OrderStatusPieChart({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-order-status', dateRange],
    queryFn: () => analyticsApi.getOrderStatusDistribution(dateRange),
    refetchInterval: 300_000,
  })

  const chartData = data?.data || []

  return (
    <WidgetShell title="Order Status" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={chartData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
              {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Legend />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
```

- [ ] **Step 3: PaymentMethodPieChart.tsx**

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

interface Props { dateRange: DateRangeParams }

export function PaymentMethodPieChart({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-payment-methods', dateRange],
    queryFn: () => analyticsApi.getRevenueByPayment(dateRange),
    refetchInterval: 300_000,
  })

  const chartData = (data?.data || []).map(d => ({ name: d.method.toUpperCase(), value: d.revenue }))

  return (
    <WidgetShell title="Payment Methods" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ৳${value.toLocaleString()}`}>
              {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Legend />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
```

- [ ] **Step 4: TopProductsTable.tsx**

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function TopProductsTable({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-top-products', dateRange],
    queryFn: () => analyticsApi.getTopProducts(dateRange),
    refetchInterval: 300_000,
  })

  const products = data?.data || []

  return (
    <WidgetShell title="Top Products" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {products.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="pb-2 font-medium w-8">#</th>
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 font-medium text-right">Sold</th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 10).map((p, i) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 font-medium truncate max-w-[180px]">{p.name}</td>
                  <td className="py-2 text-right font-semibold">{p.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetShell>
  )
}
```

---

### Task 10: Analytics Page Shell + Route

**Files:**
- Create: `apps/admin/src/features/analytics/index.tsx` — page component
- Replace: `apps/admin/src/routes/_authenticated/mon/analytics/index.tsx` — route

- [ ] **Step 1: Create page component**

```tsx
'use client'

import { useDateFilter } from '../../dashboard/use-date-filter'
import { salesChannelApi } from '../../dashboard/api'
import { SalesKpiCards } from './components/SalesKpiCards'
import { RevenueTrendChart } from './components/RevenueTrendChart'
import { MarketingKpiWidget } from './components/MarketingKpiWidget'
import { TrafficSourcesChart } from './components/TrafficSourcesChart'
import { OrderStatusPieChart } from './components/OrderStatusPieChart'
import { PaymentMethodPieChart } from './components/PaymentMethodPieChart'
import { TopProductsTable } from './components/TopProductsTable'

export default function AnalyticsPage() {
  const { preset, dateRange, setPreset, setCustomRange, formatParam } = useDateFilter()

  const range = {
    startDate: formatParam(dateRange.start),
    endDate: formatParam(dateRange.end),
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <div className="flex items-center gap-2">
          {['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'].map(p => (
            <button
              key={p}
              onClick={() => setPreset(p as any)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                preset === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      <SalesKpiCards dateRange={range} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueTrendChart dateRange={range} />
        <MarketingKpiWidget dateRange={range} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrafficSourcesChart dateRange={range} />
        <PaymentMethodPieChart dateRange={range} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrderStatusPieChart dateRange={range} />
        <TopProductsTable dateRange={range} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace route placeholder**

Edit `apps/admin/src/routes/_authenticated/mon/analytics/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import AnalyticsPage from '@/features/analytics'

export const Route = createFileRoute('/_authenticated/mon/analytics/')({
  component: AnalyticsPage,
})
```

---

### Task 11: Update Existing Dashboard Analytics Endpoint

**Files:**
- Modify: `apps/backend/src/dashboard/dashboard.service.ts`

- [ ] **Step 1: Fix getAnalytics to return real data**

Replace lines 87-121 (entire `getAnalytics` method) with:

```ts
async getAnalytics(startDate?: string, endDate?: string) {
  try {
    const effectiveDateFilter =
      startDate || endDate
        ? this.dateFilter(startDate, endDate)
        : { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } };

    const [ordersLast30Days, revenueLast30Days, pageViewCount] = await Promise.all([
      this.prisma.order.count({ where: { ...effectiveDateFilter } }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { ...effectiveDateFilter, status: 'PAID' },
      }),
      this.prisma.pageView.count({
        where: {
          timestamp: effectiveDateFilter.createdAt
            ? { gte: effectiveDateFilter.createdAt.gte, lte: effectiveDateFilter.createdAt.lte }
            : { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return {
      ordersLast30Days,
      revenueLast30Days: Number(revenueLast30Days._sum.amount || 0),
      totalClicks: pageViewCount,
      uniqueVisitors: 0,
      bounceRate: '0%',
    };
  } catch (error) {
    this.logger.error(`getAnalytics failed: ${(error as Error).message}`, (error as Error).stack);
    throw new InternalServerErrorException('Failed to fetch analytics');
  }
}
```

Note: This is a minimal fix for backward compatibility. The full analytics now comes from `AnalyticsService`.

---

### Task 12: End-to-End Verification

- [ ] **Step 1: Run backend tests**

```bash
cd apps/backend
npx jest --passWithNoTests
```

Expected: All existing tests pass.

- [ ] **Step 2: Start backend and verify endpoints**

```bash
cd apps/backend
npx nest start
```

In another terminal:
```bash
# Test page view endpoint
curl -X POST http://localhost:4000/api/tracking/page-view \
  -H "Content-Type: application/json" \
  -d '{"url":"https://shop.com/test","referrer":"https://facebook.com/page","sessionId":"test-session-1"}'

# Test analytics endpoints
curl http://localhost:4000/api/analytics/sales-kpi
curl http://localhost:4000/api/analytics/revenue-trend
curl http://localhost:4000/api/analytics/marketing-kpi
curl http://localhost:4000/api/analytics/traffic-sources
```

Expected: All return JSON with data.

- [ ] **Step 3: Frontend build check**

```bash
cd apps/admin
npx tsc --noEmit
```

Expected: No TypeScript errors.
