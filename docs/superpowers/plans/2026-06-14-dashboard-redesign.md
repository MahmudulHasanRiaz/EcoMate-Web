# Dashboard Redesign Implementation Plan
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder shadcn dashboard at `/mon/` and `/op/` with two real, role-aware, widget-based dashboards driven by live data and a shared date filter.

**Architecture:** Widget-grid system. Each widget is an independent component wrapped in `WidgetShell` (skeleton/error/empty states). A `DashboardWrapper` picks the right widget config based on route (`/mon` vs `/op`). A shared `useDateFilter` hook syncs with URL query params and feeds `dateRange` to every widget. Role filtering hides widgets below the user's role.

**Tech Stack:** React (TanStack Router + Query), Tailwind CSS, shadcn/ui, recharts, NestJS backend, Prisma

---

## File Structure

```
# Backend
apps/backend/src/dashboard/
├── dashboard.controller.ts          MODIFY — add new endpoints
├── dashboard.service.ts             MODIFY — add query methods with date range
└── dashboard.module.ts              MODIFY — no changes needed unless adding providers

# Frontend — Admin
apps/admin/src/features/dashboard/
├── types.ts                         CREATE — WidgetConfig, WidgetProps, RoleKey, DatePresetKey
├── constants.ts                     CREATE — role hierarchy, date presets
├── api.ts                           MODIFY — new API functions for all widgets
├── use-date-filter.ts               CREATE — hook that syncs filter with URL
├── components/
│   ├── WidgetShell.tsx              CREATE — unified wrapper (card + skeleton + error + empty)
│   ├── KpiCard.tsx                  CREATE — single KPI value card
│   ├── KpiRow.tsx                   CREATE — row of 4-5 KpiCards
│   ├── DateFilter.tsx               CREATE — preset buttons + custom range picker
│   ├── DashboardGrid.tsx            CREATE — grid layout mapping config to rendered widgets
│   └── DashboardWrapper.tsx         CREATE — reads route, picks config, renders grid + filter
├── config/
│   ├── mon-widgets.ts               CREATE — widget config array for /mon
│   └── op-widgets.ts                CREATE — widget config array for /op
├── widgets/
│   ├── RevenueChart.tsx             CREATE — line chart (recharts)
│   ├── OrderStatusChart.tsx         CREATE — donut/pie chart
│   ├── TopProducts.tsx              CREATE — horizontal bar chart
│   ├── PendingOrders.tsx            CREATE — table with action buttons
│   ├── LowStockAlert.tsx            CREATE — list with count badges
│   ├── RecentOrders.tsx             CREATE — table
│   ├── NewCustomers.tsx             CREATE — list
│   ├── ActivityLog.tsx              CREATE — feed list
│   ├── TodayKpiRow.tsx              CREATE — simplified KPI row for /op
│   ├── QuickOrderSearch.tsx         CREATE — search input + results
│   └── ... (remaining widgets as needed)
└── index.ts                         CREATE — re-exports DashboardWrapper

# Routes — Admin
apps/admin/src/routes/_authenticated/mon/index.tsx    MODIFY — use DashboardWrapper with route='mon'
apps/admin/src/routes/_authenticated/op/index.tsx     MODIFY — use DashboardWrapper with route='op'
```

---

### Task 1: Backend Dashboard Endpoints

**Files:**
- Modify: `apps/backend/src/dashboard/dashboard.service.ts`
- Modify: `apps/backend/src/dashboard/dashboard.controller.ts`

- [ ] **Step 1: Refactor dashboard.service.ts to accept optional date range on existing methods**

Read the current file. Add a helper to compute `dateFilter` from optional `startDate`/`endDate` query params. Modify `getStats()` to accept `startDate?: string, endDate?: string` and apply to aggregations. Modify `getAnalytics()` similarly.

```typescript
// Add to dashboard.service.ts
private dateFilter(startDate?: string, endDate?: string): { createdAt?: { gte?: Date; lte?: Date } } {
  if (!startDate && !endDate) return {};
  const filter: { gte?: Date; lte?: Date } = {};
  if (startDate) filter.gte = new Date(startDate);
  if (endDate) filter.lte = new Date(endDate + 'T23:59:59.999Z');
  return { createdAt: filter };
}
```

- [ ] **Step 2: Add new query methods to dashboard.service.ts**

Add these methods:

```typescript
async getPendingOrders(startDate?: string, endDate?: string) {
  return this.prisma.order.findMany({
    where: {
      ...this.dateFilter(startDate, endDate),
      status: { name: { in: ['Pending', 'Payment Pending'] } },
      isActive: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { status: true, customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } }, _count: { select: { items: true } } },
  });
}

async getLowStockProducts() {
  return this.prisma.product.findMany({
    where: { manageStock: true, stock: { lte: Prisma.raw('"lowStockQty"') } },
    select: { id: true, name: true, slug: true, sku: true, stock: true, lowStockQty: true, images: true },
    take: 20,
    orderBy: { stock: 'asc' },
  });
}

async getTopProducts(startDate?: string, endDate?: string, limit = 10) {
  // Use raw query or groupBy to get top N products by order item quantity
  const dateFilter = this.dateFilter(startDate, endDate);
  const orders = await this.prisma.order.findMany({
    where: { ...dateFilter, isActive: true },
    select: { id: true, items: { select: { productId: true, quantity: true, product: { select: { name: true, images: true } } } } },
  });
  const productMap = new Map<string, { name: string; image: string; quantity: number; revenue: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      if (!item.productId) continue;
      const entry = productMap.get(item.productId) || { name: item.product?.name || 'Unknown', image: (item.product?.images as any)?.[0] || '', quantity: 0, revenue: 0 };
      entry.quantity += item.quantity;
      productMap.set(item.productId, entry);
    }
  }
  return Array.from(productMap.entries())
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, limit)
    .map(([id, data]) => ({ id, ...data }));
}

async getOrderStatusDistribution(startDate?: string, endDate?: string) {
  const orders = await this.prisma.order.groupBy({
    by: ['statusId'],
    _count: true,
    where: { ...this.dateFilter(startDate, endDate), isActive: true },
  });
  const statuses = await this.prisma.orderStatus.findMany();
  const statusMap = new Map(statuses.map(s => [s.id, s.name]));
  return orders.map(o => ({ status: statusMap.get(o.statusId) || 'Unknown', count: o._count }));
}

async getRevenueByPaymentMethod(startDate?: string, endDate?: string) {
  const dateFilter = this.dateFilter(startDate, endDate);
  const payments = await this.prisma.payment.findMany({
    where: { ...dateFilter, status: 'PAID' },
    select: { gatewayCode: true, amount: true },
  });
  const grouped = new Map<string, number>();
  for (const p of payments) {
    grouped.set(p.gatewayCode || 'unknown', (grouped.get(p.gatewayCode || 'unknown') || 0) + Number(p.amount));
  }
  return Array.from(grouped.entries()).map(([method, revenue]) => ({ method, revenue }));
}

async getNewCustomers(startDate?: string, endDate?: string) {
  return this.prisma.user.findMany({
    where: { ...this.dateFilter(startDate, endDate), role: 'customer' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, firstName: true, lastName: true, email: true, createdAt: true },
  });
}

async getPendingRefunds(startDate?: string, endDate?: string) {
  return this.prisma.refund.findMany({
    where: { status: 'pending', ...this.dateFilter(startDate, endDate) },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { order: { select: { displayId: true } } },
  });
}

async getPendingDispatch() {
  return this.prisma.order.findMany({
    where: { status: { name: 'Confirmed' }, isActive: true },
    take: 10,
    orderBy: { createdAt: 'asc' },
    include: { courierDispatches: { take: 1 } },
  });
}

async getPendingPayments() {
  return this.prisma.payment.findMany({
    where: { status: 'PENDING' },
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { displayId: true } } },
  });
}

async getTodayKpi() {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const dateFilter = { createdAt: { gte: todayStart, lte: todayEnd } };
  const [orders, delivered, pendingPayments, pendingRefunds] = await Promise.all([
    this.prisma.order.count({ where: { ...dateFilter, isActive: true } }),
    this.prisma.order.count({ where: { ...dateFilter, status: { name: 'Delivered' } } }),
    this.prisma.payment.count({ where: { createdAt: { gte: todayStart }, status: 'PENDING' } }),
    this.prisma.refund.count({ where: { createdAt: { gte: todayStart }, status: 'pending' } }),
  ]);
  return { orders, delivered, pendingPayments, pendingRefunds };
}

async getActivityLog() {
  return this.prisma.order.findMany({
    take: 20,
    orderBy: { updatedAt: 'desc' },
    select: { id: true, displayId: true, status: { select: { name: true } }, updatedAt: true, customer: { select: { firstName: true, lastName: true } } },
  });
}
```

- [ ] **Step 3: Add routes in dashboard.controller.ts**

```typescript
@Get('pending-orders')
async getPendingOrders(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
  return this.dashboardService.getPendingOrders(startDate, endDate);
}

@Get('low-stock')
async getLowStockProducts() {
  return this.dashboardService.getLowStockProducts();
}

@Get('top-products')
async getTopProducts(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @Query('limit') limit?: string) {
  return this.dashboardService.getTopProducts(startDate, endDate, limit ? parseInt(limit) : 10);
}

@Get('order-status-distribution')
async getOrderStatusDistribution(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
  return this.dashboardService.getOrderStatusDistribution(startDate, endDate);
}

@Get('revenue-by-payment')
async getRevenueByPaymentMethod(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
  return this.dashboardService.getRevenueByPaymentMethod(startDate, endDate);
}

@Get('new-customers')
async getNewCustomers(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
  return this.dashboardService.getNewCustomers(startDate, endDate);
}

@Get('pending-refunds')
async getPendingRefunds(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
  return this.dashboardService.getPendingRefunds(startDate, endDate);
}

@Get('pending-dispatch')
async getPendingDispatch() {
  return this.dashboardService.getPendingDispatch();
}

@Get('pending-payments')
async getPendingPayments() {
  return this.dashboardService.getPendingPayments();
}

@Get('today-kpi')
async getTodayKpi() {
  return this.dashboardService.getTodayKpi();
}

@Get('activity-log')
async getActivityLog() {
  return this.dashboardService.getActivityLog();
}

// Update existing getStats and getAnalytics to accept date params
@Get('stats')
async getStats(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
  return this.dashboardService.getStats(startDate, endDate);
}

@Get('analytics')
async getAnalytics(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
  return this.dashboardService.getAnalytics(startDate, endDate);
}
```

- [ ] **Step 4: Verify backend builds**

Run: `cd apps/backend && npm run build | tail -5`
Expected: Build succeeds with no errors.

---

### Task 2: Frontend Types, Constants, and API Client

**Files:**
- Create: `apps/admin/src/features/dashboard/types.ts`
- Create: `apps/admin/src/features/dashboard/constants.ts`
- Modify: `apps/admin/src/features/dashboard/api.ts`

- [ ] **Step 1: Create types.ts**

```typescript
import type { ComponentType } from 'react'

export type RoleKey = 'superadmin' | 'admin' | 'manager' | 'moderator' | 'sales_executive' | 'cashier' | 'customer'

export type DatePresetKey = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time' | 'custom'

export interface DateRange {
  start: Date
  end: Date
}

export interface WidgetProps {
  dateRange: DateRange
  preset: DatePresetKey
  userRole: RoleKey
  isLoading: boolean
  error?: Error
}

export interface WidgetConfig {
  id: string
  title: string
  description?: string
  component: ComponentType<WidgetProps>
  minRole: RoleKey
  defaultSpan: number
  sizes?: {
    sm?: number
    md?: number
    lg?: number
    xl?: number
  }
  refreshInterval?: number
}

export interface DashboardRoute {
  route: 'mon' | 'op'
}

export interface DatePreset {
  key: DatePresetKey
  label: string
  getRange: () => DateRange
}

export interface KpiData {
  label: string
  value: string | number
  subtext?: string
  icon: string
  trend?: { direction: 'up' | 'down'; value: string }
  colorClass: string
}

export interface OrderSummary {
  id: string
  displayId: string
  customerName: string
  customerPhone: string
  total: number
  status: string
  itemCount: number
  createdAt: string
}

export interface LowStockItem {
  id: string
  name: string
  sku: string
  stock: number
  lowStockQty: number
}

export interface TopProduct {
  id: string
  name: string
  image: string
  quantity: number
}

export interface StatusCount {
  status: string
  count: number
}

export interface RevenueByMethod {
  method: string
  revenue: number
}

export interface NewCustomer {
  id: string
  firstName: string
  lastName: string
  email: string
  createdAt: string
}

export interface PendingRefund {
  id: string
  order: { displayId: string }
  createdAt: string
  amount: number
}

export interface ActivityEntry {
  id: string
  displayId: string
  status: string
  customerName: string
  updatedAt: string
}

export interface TodayKpi {
  orders: number
  delivered: number
  pendingPayments: number
  pendingRefunds: number
}
```

- [ ] **Step 2: Create constants.ts**

```typescript
import type { RoleKey, DatePresetKey, DateRange, DatePreset } from './types'

export const ROLE_HIERARCHY: Record<RoleKey, number> = {
  superadmin: 100,
  admin: 80,
  manager: 60,
  moderator: 40,
  sales_executive: 20,
  cashier: 10,
  customer: 0,
}

export function canAccess(userRole: RoleKey, minRole: RoleKey): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 0)
}

export const DATE_PRESETS: DatePreset[] = [
  { key: 'today', label: 'Today', getRange: () => { const s = new Date(); s.setHours(0,0,0,0); const e = new Date(); return { start: s, end: e } } },
  { key: 'yesterday', label: 'Yesterday', getRange: () => { const s = new Date(); s.setDate(s.getDate()-1); s.setHours(0,0,0,0); const e = new Date(); e.setDate(e.getDate()-1); e.setHours(23,59,59,999); return { start: s, end: e } } },
  { key: 'last_7_days', label: 'Last 7 days', getRange: () => { const s = new Date(); s.setDate(s.getDate()-7); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'last_30_days', label: 'Last 30 days', getRange: () => { const s = new Date(); s.setDate(s.getDate()-30); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'this_month', label: 'This Month', getRange: () => { const s = new Date(); s.setDate(1); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'last_month', label: 'Last Month', getRange: () => { const s = new Date(); s.setMonth(s.getMonth()-1); s.setDate(1); s.setHours(0,0,0,0); const e = new Date(); e.setDate(0); e.setHours(23,59,59,999); return { start: s, end: e } } },
  { key: 'this_quarter', label: 'This Quarter', getRange: () => { const s = new Date(); s.setMonth(Math.floor(s.getMonth()/3)*3, 1); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'this_year', label: 'This Year', getRange: () => { const s = new Date(); s.setMonth(0, 1); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'all_time', label: 'All Time', getRange: () => { const s = new Date(2020, 0, 1); return { start: s, end: new Date() } } },
]
```

- [ ] **Step 3: Update api.ts with all dashboard API functions**

Read existing `apps/admin/src/features/dashboard/api.ts`. Replace its content with:

```typescript
import { apiClient } from '@/lib/api-client'
import type { OrderSummary, LowStockItem, TopProduct, StatusCount, RevenueByMethod, NewCustomer, PendingRefund, TodayKpi, ActivityEntry } from './types'

export interface DashboardStats {
  totalRevenue: number
  totalOrders: number
  totalCustomers: number
  totalProducts: number
  recentOrders: OrderSummary[]
}

export interface AnalyticsData {
  ordersLast30Days: number
  revenueLast30Days: number
  totalClicks: number
  uniqueVisitors: number
  bounceRate: string
}

function dateParams(startDate?: string, endDate?: string): string {
  const p = new URLSearchParams()
  if (startDate) p.set('startDate', startDate)
  if (endDate) p.set('endDate', endDate)
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export const dashboardApi = {
  getStats: (startDate?: string, endDate?: string) => apiClient.get<DashboardStats>(`/dashboard/stats${dateParams(startDate, endDate)}`),
  getAnalytics: (startDate?: string, endDate?: string) => apiClient.get<AnalyticsData>(`/dashboard/analytics${dateParams(startDate, endDate)}`),
  getPendingOrders: (startDate?: string, endDate?: string) => apiClient.get<OrderSummary[]>(`/dashboard/pending-orders${dateParams(startDate, endDate)}`),
  getLowStockProducts: () => apiClient.get<LowStockItem[]>('/dashboard/low-stock'),
  getTopProducts: (startDate?: string, endDate?: string) => apiClient.get<TopProduct[]>(`/dashboard/top-products${dateParams(startDate, endDate)}`),
  getOrderStatusDistribution: (startDate?: string, endDate?: string) => apiClient.get<StatusCount[]>(`/dashboard/order-status-distribution${dateParams(startDate, endDate)}`),
  getRevenueByPaymentMethod: (startDate?: string, endDate?: string) => apiClient.get<RevenueByMethod[]>(`/dashboard/revenue-by-payment${dateParams(startDate, endDate)}`),
  getNewCustomers: (startDate?: string, endDate?: string) => apiClient.get<NewCustomer[]>(`/dashboard/new-customers${dateParams(startDate, endDate)}`),
  getPendingRefunds: () => apiClient.get<PendingRefund[]>('/dashboard/pending-refunds'),
  getPendingDispatch: () => apiClient.get<OrderSummary[]>('/dashboard/pending-dispatch'),
  getPendingPayments: () => apiClient.get<any[]>('/dashboard/pending-payments'),
  getTodayKpi: () => apiClient.get<TodayKpi>('/dashboard/today-kpi'),
  getActivityLog: () => apiClient.get<ActivityEntry[]>('/dashboard/activity-log'),
}
```

---

### Task 3: useDateFilter Hook

**Files:**
- Create: `apps/admin/src/features/dashboard/use-date-filter.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useCallback, useMemo } from 'react'
import { useSearchParams } from '@tanstack/react-router'
import type { DatePresetKey, DateRange } from './types'
import { DATE_PRESETS } from './constants'

export function useDateFilter() {
  const [searchParams, setSearchParams] = useSearchParams()

  const preset = (searchParams.get('preset') as DatePresetKey) || 'last_30_days'
  const customStart = searchParams.get('start') || undefined
  const customEnd = searchParams.get('end') || undefined

  const dateRange: DateRange = useMemo(() => {
    if (preset === 'custom' && customStart && customEnd) {
      return { start: new Date(customStart), end: new Date(customEnd + 'T23:59:59') }
    }
    const found = DATE_PRESETS.find(p => p.key === preset)
    return found ? found.getRange() : DATE_PRESETS[0].getRange()
  }, [preset, customStart, customEnd])

  const setPreset = useCallback((key: DatePresetKey) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('preset', key)
      if (key !== 'custom') {
        next.delete('start')
        next.delete('end')
      }
      return next
    })
  }, [setSearchParams])

  const setCustomRange = useCallback((start: string, end: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('preset', 'custom')
      next.set('start', start)
      next.set('end', end)
      return next
    })
  }, [setSearchParams])

  const formatParam = useCallback((d: Date) => d.toISOString().split('T')[0], [])

  return { preset, dateRange, setPreset, setCustomRange, formatParam }
}
```

- [ ] **Step 2: Verify the file is well-formed (no TypeScript compilation yet — will check in build)**

---

### Task 4: WidgetShell, KpiCard, KpiRow Components

**Files:**
- Create: `apps/admin/src/features/dashboard/components/WidgetShell.tsx`
- Create: `apps/admin/src/features/dashboard/components/KpiCard.tsx`
- Create: `apps/admin/src/features/dashboard/components/KpiRow.tsx`

- [ ] **Step 1: Create WidgetShell.tsx**

```typescript
import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface WidgetShellProps {
  title: string
  description?: string
  isLoading: boolean
  error?: Error
  onRetry?: () => void
  children: ReactNode
  className?: string
  action?: ReactNode
}

export function WidgetShell({ title, description, isLoading, error, onRetry, children, className = '', action }: WidgetShellProps) {
  if (error) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mb-2" />
            <p className="text-sm text-muted-foreground mb-3">{error.message || 'Failed to load data'}</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="h-3 w-3 mr-1" /> Retry
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
          {description && <Skeleton className="h-3 w-48 mt-1" />}
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description && <CardDescription className="text-xs mt-0.5">{description}</CardDescription>}
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Create KpiCard.tsx**

```typescript
import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { KpiData } from '../types'

interface KpiCardProps {
  data: KpiData
}

export function KpiCard({ data }: KpiCardProps) {
  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs md:text-sm text-muted-foreground font-medium">{data.label}</p>
            <p className="text-xl md:text-2xl font-bold tracking-tight">{data.value}</p>
            {data.subtext && <p className="text-xs text-muted-foreground">{data.subtext}</p>}
          </div>
          {data.icon}
        </div>
        {data.trend && (
          <div className="flex items-center gap-1 mt-3">
            {data.trend.direction === 'up' ? (
              <TrendingUp className="h-3 w-3 text-emerald-500" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500" />
            )}
            <span className="text-xs font-medium text-emerald-600">{data.trend.value}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Create KpiRow.tsx**

```typescript
import type { KpiData } from '../types'
import { KpiCard } from './KpiCard'

interface KpiRowProps {
  items: KpiData[]
}

export function KpiRow({ items }: KpiRowProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, i) => (
        <KpiCard key={i} data={item} />
      ))}
    </div>
  )
}
```

---

### Task 5: DateFilter Component

**Files:**
- Create: `apps/admin/src/features/dashboard/components/DateFilter.tsx`

- [ ] **Step 1: Create DateFilter.tsx**

```typescript
import { useRef, useState, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { useDateFilter } from '../use-date-filter'
import { DATE_PRESETS } from '../constants'
import type { DatePresetKey } from '../types'

export function DateFilter() {
  const { preset, dateRange, setPreset, setCustomRange, formatParam } = useDateFilter()
  const [customOpen, setCustomOpen] = useState(false)
  const [startDate, setStartDate] = useState<Date | undefined>(dateRange.start)
  const [endDate, setEndDate] = useState<Date | undefined>(dateRange.end)

  const activeLabel = DATE_PRESETS.find(p => p.key === preset)?.label || 'Custom Range'

  useEffect(() => {
    if (!customOpen) {
      setStartDate(undefined)
      setEndDate(undefined)
    }
  }, [customOpen])

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Preset buttons */}
      {DATE_PRESETS.filter(p => p.key !== 'custom').map(p => (
        <Button
          key={p.key}
          variant={preset === p.key ? 'default' : 'outline'}
          size="sm"
          onClick={() => setPreset(p.key)}
          className="text-xs h-8"
        >
          {p.label}
        </Button>
      ))}

      {/* Custom range */}
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <Button variant={preset === 'custom' ? 'default' : 'outline'} size="sm" className="text-xs h-8 gap-1">
            <Calendar className="h-3 w-3" />
            {preset === 'custom' ? `${formatParam(dateRange.start)} — ${formatParam(dateRange.end)}` : 'Custom'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="end">
          <div className="flex flex-col gap-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Start Date</p>
              <CalendarComponent mode="single" selected={startDate} onSelect={d => setStartDate(d)} initialFocus />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">End Date</p>
              <CalendarComponent mode="single" selected={endDate} onSelect={d => setEndDate(d)} initialFocus />
            </div>
            <Button
              size="sm"
              disabled={!startDate || !endDate}
              onClick={() => {
                if (startDate && endDate) {
                  setCustomRange(formatParam(startDate), formatParam(endDate))
                  setCustomOpen(false)
                }
              }}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
```

---

### Task 6: DashboardGrid and DashboardWrapper

**Files:**
- Create: `apps/admin/src/features/dashboard/components/DashboardGrid.tsx`
- Create: `apps/admin/src/features/dashboard/components/DashboardWrapper.tsx`
- Create: `apps/admin/src/features/dashboard/index.ts`

- [ ] **Step 1: Create DashboardGrid.tsx**

```typescript
'use client'

import type { WidgetConfig, WidgetProps } from '../types'

interface DashboardGridProps {
  configs: WidgetConfig[]
  widgetProps: Omit<WidgetProps, 'isLoading' | 'error'>
  isLoadingMap: Record<string, boolean>
  errorMap: Record<string, Error | undefined>
}

export function DashboardGrid({ configs, widgetProps, isLoadingMap, errorMap }: DashboardGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
      {      configs.map(cfg => {
        const colSpan = cfg.sizes?.xl ?? cfg.defaultSpan
        const spanMap: Record<number, string> = { 2: 'xl:col-span-2', 3: 'xl:col-span-3', 4: 'xl:col-span-4' }
        const spanClass = spanMap[colSpan] || ''
        return (
          <div key={cfg.id} className={`${spanClass} col-span-1`}>
            <cfg.component
              dateRange={widgetProps.dateRange}
              preset={widgetProps.preset}
              userRole={widgetProps.userRole}
              isLoading={isLoadingMap[cfg.id] ?? true}
              error={errorMap[cfg.id]}
            />
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Create DashboardWrapper.tsx**

```typescript
'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { useDateFilter } from '../use-date-filter'
import { DateFilter } from './DateFilter'
import { DashboardGrid } from './DashboardGrid'
import { monWidgets } from '../config/mon-widgets'
import { opWidgets } from '../config/op-widgets'
import { canAccess } from '../constants'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { TopNav } from '@/components/layout/top-nav'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'
import type { RoleKey } from '../types'

interface DashboardWrapperProps {
  route: 'mon' | 'op'
}

export function DashboardWrapper({ route }: DashboardWrapperProps) {
  const { preset, dateRange, formatParam } = useDateFilter()
  const userRole = (useAuthStore(s => s.auth.user?.role) || 'cashier') as RoleKey

  const configs = useMemo(() => {
    const all = route === 'mon' ? monWidgets : opWidgets
    return all.filter(cfg => canAccess(userRole, cfg.minRole))
  }, [route, userRole])

  // Build a single query key from date range to force refetch on filter change
  const dateKey = `${formatParam(dateRange.start)}_${formatParam(dateRange.end)}`

  return (
    <>
      <Header>
        <TopNav links={topNav} className="me-auto" />
        <Search />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main>
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {route === 'mon' ? 'Management Dashboard' : 'Operations Dashboard'}
          </h1>
          <DateFilter />
        </div>
        <DashboardGrid
          configs={configs}
          widgetProps={{ dateRange, preset, userRole }}
          isLoadingMap={{}}
          errorMap={{}}
        />
      </Main>
    </>
  )
}

const topNav = [
  { title: 'Dashboard', href: 'dashboard/overview', isActive: true, disabled: false },
  { title: 'Orders', href: 'dashboard/orders', isActive: false, disabled: true },
  { title: 'Products', href: 'dashboard/products', isActive: false, disabled: true },
  { title: 'Customers', href: 'dashboard/customers', isActive: false, disabled: true },
]
```

- [ ] **Step 3: Create index.ts**

```typescript
export { DashboardWrapper } from './components/DashboardWrapper'
```

---

### Task 7: Core Widgets — RevenueChart, OrderStatusChart, TopProducts

**Files:**
- Create: `apps/admin/src/features/dashboard/widgets/RevenueChart.tsx`
- Create: `apps/admin/src/features/dashboard/widgets/OrderStatusChart.tsx`
- Create: `apps/admin/src/features/dashboard/widgets/TopProducts.tsx`

- [ ] **Step 1: Create RevenueChart.tsx**

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

export function RevenueChart({ dateRange, preset, userRole, isLoading: _il, error: _err }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-revenue', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getStats(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  // Build chart data from date range (daily buckets)
  const chartData = data?.data.totalRevenue ? [
    { name: 'Revenue', total: data.data.totalRevenue },
  ] : []

  return (
    <WidgetShell title="Revenue" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData}>
          <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} />
          <Tooltip />
          <Bar dataKey="total" fill="currentColor" radius={[4, 4, 0, 0]} className="fill-primary" />
        </BarChart>
      </ResponsiveContainer>
    </WidgetShell>
  )
}
```

- [ ] **Step 2: Create OrderStatusChart.tsx**

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend } from 'recharts'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

export function OrderStatusChart({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-order-status', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getOrderStatusDistribution(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const chartData = data?.data || []

  return (
    <WidgetShell title="Order Status" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie data={chartData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={({ status, count }) => `${status}: ${count}`}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </WidgetShell>
  )
}
```

- [ ] **Step 3: Create TopProducts.tsx**

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

export function TopProducts({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-top-products', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getTopProducts(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const chartData = (data?.data || []).map(p => ({ name: p.name.length > 20 ? p.name.slice(0, 20) + '…' : p.name, quantity: p.quantity }))

  return (
    <WidgetShell title="Top Products" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} layout="vertical">
          <XAxis type="number" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} width={120} />
          <Tooltip />
          <Bar dataKey="quantity" fill="currentColor" radius={[0, 4, 4, 0]} className="fill-primary" />
        </BarChart>
      </ResponsiveContainer>
    </WidgetShell>
  )
}
```

---

### Task 8: Operational Widgets — PendingOrders, LowStockAlert, PendingTasks

**Files:**
- Create: `apps/admin/src/features/dashboard/widgets/PendingOrders.tsx`
- Create: `apps/admin/src/features/dashboard/widgets/LowStockAlert.tsx`
- Create: `apps/admin/src/features/dashboard/widgets/PendingTasks.tsx`

- [ ] **Step 1: Create PendingOrders.tsx**

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { formatCurrency } from '../utils'
import type { WidgetProps } from '../types'

export function PendingOrders({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-pending-orders', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getPendingOrders(dateRange.start.toISOString(), dateRange.end.toISOString()),
    refetchInterval: 30_000,
  })

  const orders = data?.data || []

  return (
    <WidgetShell title="Pending Orders" description="Orders needing attention" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No pending orders</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Order</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs">Items</TableHead>
              <TableHead className="text-xs">Total</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map(order => (
              <TableRow key={order.id}>
                <TableCell className="font-medium text-xs">{order.displayId}</TableCell>
                <TableCell className="text-xs">{order.customerName}</TableCell>
                <TableCell className="text-xs">{order.itemCount}</TableCell>
                <TableCell className="text-xs">{formatCurrency(order.total)}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{order.status}</Badge></TableCell>
                <TableCell>
                  <Link to="/op/orders/$id" params={{ id: order.id }}>
                    <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-3 w-3" /></Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </WidgetShell>
  )
}
```

- [ ] **Step 2: Create utils.ts in dashboard (formatCurrency helper)**

```typescript
// apps/admin/src/features/dashboard/utils.ts
export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

export function formatDate(d: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(d))
}

export function timeAgo(d: string | Date): string {
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
```

- [ ] **Step 3: Create LowStockAlert.tsx**

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Package } from 'lucide-react'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

export function LowStockAlert(_props: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-low-stock'],
    queryFn: () => dashboardApi.getLowStockProducts(),
    refetchInterval: 60_000,
  })

  const items = data?.data || []

  return (
    <WidgetShell title="Low Stock" description="Products running out" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {items.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <Package className="h-8 w-8 text-emerald-500 mb-2" />
          <p className="text-sm text-muted-foreground">All products well stocked</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.sku}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {item.stock <= (item.lowStockQty || 0) && item.stock === 0 ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                    <AlertTriangle className="h-3 w-3" /> {item.stock}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-amber-600">{item.stock}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}
```

---

### Task 9: Remaining Widgets

**Files:**
- Create: `apps/admin/src/features/dashboard/widgets/RecentOrders.tsx`
- Create: `apps/admin/src/features/dashboard/widgets/NewCustomers.tsx`
- Create: `apps/admin/src/features/dashboard/widgets/ActivityLog.tsx`
- Create: `apps/admin/src/features/dashboard/widgets/TodayKpiRow.tsx`
- Create: `apps/admin/src/features/dashboard/widgets/QuickOrderSearch.tsx`

- [ ] **Step 1: Create RecentOrders.tsx**

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { formatCurrency, formatDate } from '../utils'
import type { WidgetProps } from '../types'

export function RecentOrders({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-recent-orders', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getStats(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const orders = data?.data.recentOrders || []

  return (
    <WidgetShell title="Recent Orders" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No orders</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Order</TableHead>
              <TableHead className="text-xs">Items</TableHead>
              <TableHead className="text-xs">Total</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map(order => (
              <TableRow key={order.id}>
                <TableCell className="font-medium text-xs">{order.displayId}</TableCell>
                <TableCell className="text-xs">{order.itemCount}</TableCell>
                <TableCell className="text-xs">{formatCurrency(order.total)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                <TableCell>
                  <Link to="/op/orders/$id" params={{ id: order.id }}>
                    <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-3 w-3" /></Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </WidgetShell>
  )
}
```

- [ ] **Step 2: Create NewCustomers.tsx**

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { formatDate } from '../utils'
import type { WidgetProps } from '../types'

export function NewCustomers({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-new-customers', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getNewCustomers(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const customers = data?.data || []

  return (
    <WidgetShell title="New Customers" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {customers.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <UserPlus className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No new customers</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {customers.map(c => (
            <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
              <div>
                <p className="text-sm font-medium">{c.firstName} {c.lastName}</p>
                <p className="text-xs text-muted-foreground">{c.email}</p>
              </div>
              <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}
```

- [ ] **Step 3: Create ActivityLog.tsx**

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { timeAgo } from '../utils'
import type { WidgetProps } from '../types'

export function ActivityLog(_props: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: () => dashboardApi.getActivityLog(),
    refetchInterval: 30_000,
  })

  const activities = data?.data || []

  return (
    <WidgetShell title="Activity" description="Recent order updates" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {activities.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <Activity className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No recent activity</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {activities.map(a => (
            <div key={a.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{a.displayId}</p>
                <p className="text-xs text-muted-foreground truncate">{a.customerName}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="outline" className="text-xs">{a.status}</Badge>
                <span className="text-xs text-muted-foreground">{timeAgo(a.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}
```

- [ ] **Step 4: Create TodayKpiRow.tsx**

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { ShoppingCart, Truck, Wallet, RotateCcw } from 'lucide-react'
import { KpiRow } from '../components/KpiRow'
import { dashboardApi } from '../api'
import type { WidgetProps, KpiData } from '../types'

export function TodayKpiRow(_props: WidgetProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-today-kpi'],
    queryFn: () => dashboardApi.getTodayKpi(),
    refetchInterval: 30_000,
  })

  const d = data?.data
  const items: KpiData[] = [
    { label: "Today's Orders", value: d?.orders ?? '-', icon: <ShoppingCart className="h-5 w-5 text-blue-600" />, colorClass: 'text-blue-600' },
    { label: 'Delivered', value: d?.delivered ?? '-', icon: <Truck className="h-5 w-5 text-emerald-600" />, colorClass: 'text-emerald-600' },
    { label: 'Pending Payments', value: d?.pendingPayments ?? '-', icon: <Wallet className="h-5 w-5 text-amber-600" />, colorClass: 'text-amber-600' },
    { label: 'Pending Refunds', value: d?.pendingRefunds ?? '-', icon: <RotateCcw className="h-5 w-5 text-red-600" />, colorClass: 'text-red-600' },
  ]

  return <KpiRow items={items} />
}
```

- [ ] **Step 5: Create QuickOrderSearch.tsx**

```typescript
'use client'

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search as SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { WidgetShell } from '../components/WidgetShell'
import type { WidgetProps } from '../types'

export function QuickOrderSearch(_props: WidgetProps) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const handleSearch = () => {
    if (!query.trim()) return
    navigate({ to: '/op/orders', search: { search: query.trim() } })
  }

  return (
    <WidgetShell title="Quick Search" description="Find order by ID or phone" isLoading={false}>
      <div className="flex gap-2">
        <Input
          placeholder="Order ID or phone number..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="flex-1"
        />
        <Button onClick={handleSearch}><SearchIcon className="h-4 w-4" /></Button>
      </div>
    </WidgetShell>
  )
}
```

---

### Task 10: Widget Configs and Route Wiring

**Files:**
- Create: `apps/admin/src/features/dashboard/config/mon-widgets.ts`
- Create: `apps/admin/src/features/dashboard/config/op-widgets.ts`
- Modify: `apps/admin/src/routes/_authenticated/mon/index.tsx`
- Modify: `apps/admin/src/routes/_authenticated/op/index.tsx`

- [ ] **Step 1: Create mon-widgets.ts**

```typescript
import type { WidgetConfig } from '../types'
import { RevenueChart } from '../widgets/RevenueChart'
import { OrderStatusChart } from '../widgets/OrderStatusChart'
import { TopProducts } from '../widgets/TopProducts'
import { PendingOrders } from '../widgets/PendingOrders'
import { LowStockAlert } from '../widgets/LowStockAlert'
import { RecentOrders } from '../widgets/RecentOrders'
import { NewCustomers } from '../widgets/NewCustomers'
import { ActivityLog } from '../widgets/ActivityLog'

export const monWidgets: WidgetConfig[] = [
  { id: 'revenue', title: 'Revenue', component: RevenueChart, minRole: 'manager', defaultSpan: 2 },
  { id: 'order-status', title: 'Order Status', component: OrderStatusChart, minRole: 'manager', defaultSpan: 1 },
  { id: 'top-products', title: 'Top Products', component: TopProducts, minRole: 'manager', defaultSpan: 1 },
  { id: 'pending-orders', title: 'Pending Orders', component: PendingOrders, minRole: 'moderator', defaultSpan: 2 },
  { id: 'low-stock', title: 'Low Stock', component: LowStockAlert, minRole: 'moderator', defaultSpan: 1 },
  { id: 'recent-orders', title: 'Recent Orders', component: RecentOrders, minRole: 'moderator', defaultSpan: 2 },
  { id: 'new-customers', title: 'New Customers', component: NewCustomers, minRole: 'sales_executive', defaultSpan: 1 },
  { id: 'activity', title: 'Activity', component: ActivityLog, minRole: 'manager', defaultSpan: 1 },
]
```

- [ ] **Step 2: Create op-widgets.ts**

```typescript
import type { WidgetConfig } from '../types'
import { TodayKpiRow } from '../widgets/TodayKpiRow'
import { QuickOrderSearch } from '../widgets/QuickOrderSearch'
import { PendingOrders } from '../widgets/PendingOrders'
import { LowStockAlert } from '../widgets/LowStockAlert'

export const opWidgets: WidgetConfig[] = [
  { id: 'today-kpi', title: "Today's Overview", component: TodayKpiRow, minRole: 'cashier', defaultSpan: 4 },
  { id: 'quick-search', title: 'Quick Search', component: QuickOrderSearch, minRole: 'cashier', defaultSpan: 1 },
  { id: 'pending-orders', title: 'Pending Orders', component: PendingOrders, minRole: 'cashier', defaultSpan: 2 },
  { id: 'low-stock', title: 'Low Stock', component: LowStockAlert, minRole: 'moderator', defaultSpan: 1 },
]
```

- [ ] **Step 3: Update mon/index.tsx**

Read `apps/admin/src/routes/_authenticated/mon/index.tsx`. Replace content with:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { DashboardWrapper } from '@/features/dashboard'

export const Route = createFileRoute('/_authenticated/mon/')({
  component: () => <DashboardWrapper route="mon" />,
})
```

- [ ] **Step 4: Update op/index.tsx**

Read `apps/admin/src/routes/_authenticated/op/index.tsx`. Replace content with:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { DashboardWrapper } from '@/features/dashboard'

export const Route = createFileRoute('/_authenticated/op/')({
  component: () => <DashboardWrapper route="op" />,
})
```

- [ ] **Step 5: Verify entire admin build**

Run: `cd apps/admin && npm run build | tail -10`
Expected: Build succeeds (only known pre-existing errors in unrelated files are acceptable)
