/**
 * Monitoring Dashboard & Analytics consolidation tests.
 *
 * Sidebar canonical structure · Business Overview rendered directly at
 * /mon/analytics · Dashboard boundary (no duplicate financial KPIs) ·
 * Help page Bengali sections.
 */
import { describe, expect, it, vi, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { monWidgets } from '@/features/dashboard/config/mon-widgets'
import { sidebarData } from '@/components/layout/data/sidebar-data'
import AnalyticsHelp from '@/features/business-analytics/help'
import { DrilldownPanel } from '@/features/business-analytics/components/DrilldownPanel'
import { SettlementTable } from '@/features/business-analytics/components/SettlementTable'
import { SALES_DRILLDOWN } from '@/features/business-analytics/sales'
import { EXPENSES_DRILLDOWN } from '@/features/business-analytics/expenses'
import { DEFAULT_FILTERS } from '@/features/business-analytics/types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  // Minimal stub so route modules under test can be imported in browser mode.
  createFileRoute: (_path: string) => (opts: { component: unknown }) => ({ options: opts }),
}))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/layout/header', () => ({ Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))

function wrap(ui: ReactElement) {
  return render(ui)
}

describe('analytics consolidation', () => {
  it('sidebar Analytics children match the canonical per-page paths', () => {
    const monitoringGroup = sidebarData.navGroups.find(g => g.panel === 'monitoring')!
    const analytics = monitoringGroup.items.find(i => i.title === 'Analytics')!
    const urls = ('items' in analytics && analytics.items ? analytics.items : []).map(s => s.url)
    expect(urls).toContain('/mon/analytics')
    expect(urls).toContain('/mon/analytics/sales')
    expect(urls).toContain('/mon/analytics/products')
    expect(urls).toContain('/mon/analytics/customers')
    expect(urls).toContain('/mon/analytics/marketing')
    expect(urls).toContain('/mon/analytics/inventory')
    expect(urls).toContain('/mon/analytics/expenses')
    expect(urls).toContain('/mon/analytics/help')
  })

  it('Dashboard keeps only monitoring signals — no duplicate financial KPIs', () => {
    const ids = monWidgets.map(w => w.id)
    // Removed: historical financial duplicates of Analytics (revenue by
    // payment method → Sales payment tab; quantity ranking → Products P&L).
    expect(ids).not.toContain('revenue')
    expect(ids).not.toContain('top-products')
    // Kept: attention-needed counts, in-flight, exceptions, recent activity.
    expect(ids).toEqual(
      expect.arrayContaining(['today-kpi', 'order-status', 'new-customers', 'low-stock', 'recent-orders', 'activity']),
    )
  })
})

describe('drill hrefs resolve to existing canonical routes', () => {
  // Canonical analytics landing + per-page paths come from the sidebar (the
  // source of truth asserted above); op drill targets are real routes.
  function canonicalPaths(): Set<string> {
    const monitoringGroup = sidebarData.navGroups.find(g => g.panel === 'monitoring')!
    const analytics = monitoringGroup.items.find(i => i.title === 'Analytics')!
    const urls = ('items' in analytics && analytics.items ? analytics.items : []).map(s => s.url)
    return new Set([...urls, '/op/orders', '/op/dispatch', '/op/expense-categories'])
  }

  function expectResolves(hrefs: string[]) {
    const canonical = canonicalPaths()
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href.startsWith('/mon/analytics/overview'), `dead link ${href}`).toBe(false)
      const path = href.split('?')[0]
      expect(canonical.has(path), `drill href ${href} resolves to a canonical route`).toBe(true)
    }
  }

  it('default DrilldownPanel rows land on canonical routes and keep query params', async () => {
    const { container } = await wrap(<DrilldownPanel filters={DEFAULT_FILTERS} />)
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href') ?? '')
    expectResolves(hrefs)
    // The Business Overview renders directly at /mon/analytics — the drill
    // dimensions survive as query params on the canonical landing.
    expect(hrefs.some(h => h.startsWith('/mon/analytics?') && h.includes('view=ladder'))).toBe(true)
    expect(hrefs.some(h => h.includes('view=bridge'))).toBe(true)
    expect(hrefs.some(h => h.includes('view=fulfillment'))).toBe(true)
    expect(hrefs.some(h => h.includes('view=coverage'))).toBe(true)
  })

  it('sales + expenses drill rows land on canonical routes and keep query params', async () => {
    const { container } = await wrap(
      <DrilldownPanel filters={DEFAULT_FILTERS} items={[...SALES_DRILLDOWN, ...EXPENSES_DRILLDOWN]} />,
    )
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href') ?? '')
    expectResolves(hrefs)
    expect(hrefs.some(h => h.startsWith('/mon/analytics?') && h.includes('view=ladder'))).toBe(true)
    expect(hrefs.some(h => h.includes('view=reconciliation'))).toBe(true)
    expect(hrefs.some(h => h.includes('/mon/analytics/expenses?') && h.includes('view=list'))).toBe(true)
  })

  it('SettlementTable header link lands on the canonical overview landing', async () => {
    const { container } = await wrap(
      <SettlementTable
        rows={[]}
        total={0}
        page={1}
        pageSize={20}
        totalPages={0}
        gapBanner={{ codOrders: 0, courierCost: 0, message: '' }}
        panelNote=""
        onPageChange={() => {}}
      />,
    )
    const href = container.querySelector('a')?.getAttribute('href') ?? ''
    expect(href).toBe('/mon/analytics')
  })
})

describe('AnalyticsHelp', () => {
  it('renders the intro plus all 10 Bengali sections', async () => {
    const { getByText, getByTestId } = await wrap(<AnalyticsHelp />)

    await expect.element(getByTestId('analytics-help')).toBeInTheDocument()
    await expect.element(getByText(/শুধু.*ডেলিভারি হওয়া অর্ডারই.*বিক্রি হিসেবে ধরা হয়/)).toBeInTheDocument()
    await expect.element(getByText('১. সবার আগে: Business Overview')).toBeInTheDocument()
    await expect.element(getByText('২. বিক্রি: Sales & Orders')).toBeInTheDocument()
    await expect.element(getByText('৩. পণ্য: Products')).toBeInTheDocument()
    await expect.element(getByText('৪. কাস্টমার: Customers')).toBeInTheDocument()
    await expect.element(getByText('৫. মার্কেটিং: Marketing')).toBeInTheDocument()
    await expect.element(getByText('৬. ইনভেন্টরি: Inventory')).toBeInTheDocument()
    await expect.element(getByText('৭. খরচ: Expenses')).toBeInTheDocument()
    await expect.element(getByText('৮. ড্রিল-ডাউন: সংখ্যা থেকে অর্ডার পর্যন্ত')).toBeInTheDocument()
    await expect.element(getByText('৯. খরচ ও কভারেজ: যা নেই তা শূন্য নয়')).toBeInTheDocument()
    await expect.element(getByText('১০. নিয়ম: Dashboard বনাম Analytics')).toBeInTheDocument()
  })

  it('states missing cost is never silently zero and the Dashboard-vs-Analytics rule', async () => {
    const { getByText } = await wrap(<AnalyticsHelp />)

    await expect.element(getByText(/শূন্য ধরে নেওয়া হয় না/)).toBeInTheDocument()
    await expect.element(getByText(/Dashboard মানে/)).toBeInTheDocument()
    await expect.element(getByText(/Analytics মানে/)).toBeInTheDocument()
  })
})
