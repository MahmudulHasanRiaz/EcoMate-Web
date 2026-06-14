# Dashboard Redesign — EcoMate Admin

**Date:** 2026-06-14  
**Status:** Design Approved  
**Author:** OpenCode

## Table of Contents

1. [Overview](#1-overview)
2. [Roles & Permissions](#2-roles--permissions)
3. [Widget Architecture](#3-widget-architecture)
4. [Dashboard Configurations](#4-dashboard-configurations)
5. [Date Filter System](#5-date-filter-system)
6. [Data Flow](#6-data-flow)
7. [Design Language](#7-design-language)
8. [Project Structure](#8-project-structure)

---

## 1. Overview

Two separate widget-based dashboards at `/mon/` (management) and `/op/` (operations). Both share the same widget engine but use different widget configurations. A unified date filter controls all widgets simultaneously. Role-based visibility determines which widgets each user sees.

### Key Principles

- **Widget-based**: Every data block is an independent widget
- **Role-filterable**: Each widget has a `minRole` — users below that role don't see it
- **Date-aware**: All widgets respect the shared date filter (preset or custom range)
- **Instantly useful**: KPI-driven, actionable, not decorative
- **Minimal & modern**: Clean cards, consistent spacing, subtle shadows

---

## 2. Roles & Permissions

### Role Hierarchy (highest → lowest)

```
superadmin   >   admin   >   manager   >   moderator   >   sales_executive   >   cashier   >   customer
```

### Role Access Intent

| Role | Access |
|---|---|
| **superadmin** | Everything — full system access |
| **admin** | Almost everything except system-level configuration |
| **manager** | All operational + management overview, no system settings |
| **moderator** | Content management (reviews, categories, CMS), operational read-only |
| **sales_executive** | Customer management, order lookup, basic dashboards |
| **cashier** | Order creation, order list, basic operational data |
| **customer** | Not used in admin (storefront only) |

### Widget Visibility

Each widget config includes a `minRole: RoleKey` field. On render:

```
if (userRoleOrder >= widget.minRoleOrder) → show widget
```

The role order mapping is defined once in a central config.

---

## 3. Widget Architecture

### WidgetConfig Type

```typescript
interface WidgetConfig {
  id: string
  title: string
  description?: string
  component: React.ComponentType<WidgetProps>
  minRole: RoleKey          // minimum role to see this
  defaultSpan: number       // grid columns: 1, 2, 3, or 4
  sizes: {
    sm?: number             // mobile (default: 1)
    md?: number             // tablet (default: 1)
    lg?: number             // desktop (default: defaultSpan)
    xl?: number             // wide (default: defaultSpan)
  }
  refreshInterval?: number  // ms, for auto-refresh
}
```

### WidgetProps

```typescript
interface WidgetProps {
  dateRange: { start: Date; end: Date }
  preset: DatePresetKey       // 'today' | 'last_7_days' | 'last_30_days' | 'this_month' | 'this_year' | 'all_time' | 'custom'
  userRole: RoleKey
  isLoading: boolean
  error?: Error
}
```

### Widget Shell (WidgetShell.tsx)

Every widget is wrapped in `WidgetShell` which provides:

- Consistent card layout (header with icon + title + optional actions)
- Loading skeleton state
- Error state with retry button
- Empty state
- Responsive padding & spacing

### Widget List

#### Shared Widgets (appear on both `/mon` and `/op`)

| Widget | Description | minRole |
|---|---|---|
| **PendingOrders** | Table of pending orders with inline action buttons | cashier |
| **LowStockAlert** | Products below low-stock threshold | cashier |
| **PendingTasks** | Task list (from Task model) | moderator |

#### /mon-Only Widgets (management)

| Widget | Description | minRole |
|---|---|---|
| **RevenueChart** | Line/bar chart — revenue over time | manager |
| **KpiRow** | 4 KPI cards: Revenue, Orders, Customers, Products | manager |
| **OrderStatusChart** | Donut chart — order status distribution | manager |
| **TopProducts** | Bar chart — top N selling products | manager |
| **PaymentMethodChart** | Revenue breakdown by payment method | manager |
| **RecentOrders** | Detailed recent orders table | moderator |
| **NewCustomers** | Recent customer signups | sales_executive |
| **ActivityLog** | Recent system activity feed | manager |
| **RefundPending** | Pending refund requests | admin |
| **CourierPending** | Pending courier dispatch requests | cashier |

#### /op-Only Widgets (operations)

| Widget | Description | minRole |
|---|---|---|
| **TodayKpiRow** | Today's KPI: orders, deliveries, pending payments, refunds | cashier |
| **QuickOrderSearch** | Search by Order ID / Phone — immediate action | cashier |
| **PendingDispatch** | Courier-ready orders not yet dispatched | cashier |
| **PendingPayments** | Unconfirmed payment verifications | cashier |
| **TodayActivity** | Minimal activity feed for today | moderator |

---

## 4. Dashboard Configurations

### /mon/ Dashboard

Layout:
```
┌──────────────────────────────────────────────┐
│  Date Filter Bar                              │
├──────────┬──────────┬──────────┬─────────────┤
│  KpiRow (xl: col-span-4) span: 4             │
├──────────┬──────────┬──────────┬─────────────┤
│ Revenue  │ OrderStat │ TopProd  │ PaymentMth  │
│ Chart    │   Chart   │ ucts     │   Chart     │
│ span: 2  │ span: 1   │ span: 1  │   span: 2   │
├──────────┴──────────┴──────────┴─────────────┤
│  PendingOrders (span: 2)  │ LowStock (span: 1)│
│                           │ PendingTasks(span:1│
├──────────┬──────────┬──────────┬─────────────┤
│ Recent   │ NewCust  │ Activity │ RefundPend   │
│ Orders   │ omers    │ Log      │             │
│ span: 2  │ span: 1  │ span: 1  │ span: 1      │
└──────────┴──────────┴──────────┴─────────────┘
```

### /op/ Dashboard

Layout:
```
┌──────────────────────────────────────────────┐
│  Date Filter Bar (simpler — Today focus)      │
├──────────┬──────────┬──────────┬─────────────┤
│  TodayKpiRow (xl: col-span-4)                │
├──────────┴──────────┴──────────┴─────────────┤
│  QuickOrderSearch (xl: col-span-2)            │
│  PendingOrders (xl: col-span-3)              │
├──────────┬──────────┬──────────┬─────────────┤
│ Pending  │ Pending  │ LowStock │ Today       │
│ Dispatch │ Payments │ Alert    │ Activity    │
│ span: 1  │ span: 1  │ span: 1  │ span: 1     │
└──────────┴──────────┴──────────┴─────────────┘
```

---

## 5. Date Filter System

### Presets

- `today` — Today 00:00:00 → now
- `yesterday` — Yesterday 00:00:00 → 23:59:59
- `last_7_days` — 7 days ago → now
- `last_30_days` — 30 days ago → now
- `this_month` — Month start → now
- `last_month` — Previous month
- `this_quarter` — Quarter start → now
- `this_year` — Year start → now
- `all_time` — No filter

### Custom Range

Two date inputs (or calendar popover):
- Start date
- End date

### URL Sync

Filter state serialized to URL query params:

```
/admin/mon?preset=last_30_days
/admin/mon?start=2026-06-01&end=2026-06-14
```

This enables:
- Bookmarkable URLs
- Browser back/forward navigation
- Shareable filter states

### How it propagates

```
DateFilter (sets preset/start/end)
  → useDateFilter hook (synced with URL)
    → each widget via WidgetProps.dateRange
      → widget queries API with date params
        → backend returns filtered data
```

---

## 6. Data Flow

### Backend API Endpoints

The existing `/dashboard/stats` and `/dashboard/analytics` endpoints are insufficient. New endpoints needed:

| Method | Endpoint | Description |
|---|---|---|
| GET | `/dashboard/stats` | Enhanced: accepts `startDate`, `endDate` query params |
| GET | `/dashboard/analytics` | Enhanced: accepts date range params |
| GET | `/dashboard/pending-orders` | Pending orders for ops dashboard |
| GET | `/dashboard/low-stock` | Low stock products |
| GET | `/dashboard/top-products` | Top N selling products in range |
| GET | `/dashboard/order-status-distribution` | Order count per status |
| GET | `/dashboard/revenue-by-payment` | Revenue grouped by payment method |
| GET | `/dashboard/new-customers` | Recent customer registrations |
| GET | `/dashboard/pending-refunds` | Pending refund requests |
| GET | `/dashboard/pending-dispatch` | Courier-ready orders |
| GET | `/dashboard/pending-payments` | Unconfirmed payments |
| GET | `/dashboard/activity-log` | Recent system activity |
| GET | `/dashboard/today-kpi` | Today-specific KPI numbers |

### Client Data Fetching

- Each widget fetches its own data using `@tanstack/react-query`
- Query keys include the date range so they auto-refetch when filter changes
- `refetchInterval` for widgets that need polling (e.g., `PendingOrders` every 30s)
- Widget shows skeleton on load, error state on failure

### Caching

- Standard react-query caching (staleTime configurable per widget)
- Backend endpoint caching via NestJS cache where appropriate
- No localStorage—dashboard data is always fresh from API

---

## 7. Design Language

### Grid

```css
grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6
```

### Cards

- Background: white (`bg-card`)
- Border: `border border-border/50`
- Radius: `rounded-lg` or `rounded-xl`
- Shadow: `shadow-sm` with `hover:shadow-md` transition
- Padding: `p-4 md:p-6`
- Transition: `transition-all duration-200`

### KPI Cards

- Icon in a soft-colored circle (e.g., `bg-emerald-100 text-emerald-600`)
- Value: bold, large (`text-2xl font-bold`)
- Label: small, muted (`text-xs md:text-sm text-muted-foreground`)
- Trend indicator: optional small badge (up/down vs previous period)

### Charts

- `recharts` for all charts (already a dependency)
- Consistent color palette from CSS variables (`--primary`, `--chart-1`..`--chart-5`)
- Minimal gridlines, no axis labels where not essential
- Responsive container

### Loading

- `Skeleton` component from shadcn for widget shells
- No spinner spinners in widgets — use skeleton shapes matching content

### Empty State

- Centered icon + text: "No data for this period"

---

## 8. Project Structure

```
apps/admin/src/features/dashboard/
├── DashboardWrapper.tsx         → reads route (/mon vs /op), picks config, renders grid
├── config/
│   ├── mon-widgets.ts           → /mon widget list with grid positions
│   └── op-widgets.ts            → /op widget list with grid positions
├── types.ts                     → WidgetConfig, WidgetProps, RoleKey, DatePresetKey
├── constants.ts                 → role hierarchy order, preset definitions
├── hooks/
│   ├── use-dashboard.ts         → fetches and caches widget registry
│   └── use-date-filter.ts      → manages filter state, syncs with URL
├── widgets/
│   ├── RevenueChart.tsx
│   ├── OrderStatusChart.tsx
│   ├── TopProducts.tsx
│   ├── PaymentMethodChart.tsx
│   ├── PendingOrders.tsx
│   ├── LowStockAlert.tsx
│   ├── PendingTasks.tsx
│   ├── NewCustomers.tsx
│   ├── RecentOrders.tsx
│   ├── ActivityLog.tsx
│   ├── RefundPending.tsx
│   ├── CourierPending.tsx
│   ├── PendingDispatch.tsx
│   ├── PendingPayments.tsx
│   ├── TodayKpiRow.tsx
│   ├── QuickOrderSearch.tsx
│   └── TodayActivity.tsx
├── components/
│   ├── WidgetShell.tsx          → card wrapper with header/skeleton/error/empty
│   ├── KpiCard.tsx              → single KPI value card
│   ├── KpiRow.tsx               → row of 4 KpiCards
│   ├── DateFilter.tsx           → preset buttons + custom range picker
│   └── DashboardGrid.tsx        → maps widgets to grid positions
├── api.ts                       → API client functions for all dashboard endpoints
└── routes/
    ├── mon-index.tsx            → simple route wrapper importing DashboardWrapper
    └── op-index.tsx             → simple route wrapper importing DashboardWrapper
```
