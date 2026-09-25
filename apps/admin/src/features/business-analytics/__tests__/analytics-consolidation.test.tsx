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
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
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
  const HEADINGS = [
    'Analytics কী?',
    'কোথা থেকে শুরু করবেন',
    'কোন প্রশ্নের জন্য কোন page?',
    'সমস্যা খোঁজার workflow',
    'Data status কী বোঝায়?',
    'Dashboard বনাম Analytics',
    'শেষ কথা',
  ]

  const HELP_LINKS: [question: string, page: string, href: string][] = [
    ['Business কেমন করেছে?', 'Business Overview', '/mon/analytics'],
    ['Sales/Return/Refund?', 'Sales & Orders', '/mon/analytics/sales'],
    ['কোন Product লাভ?', 'Products', '/mon/analytics/products'],
    ['Customer performance?', 'Customers', '/mon/analytics/customers'],
    ['Marketing spend কাজ?', 'Marketing', '/mon/analytics/marketing'],
    ['Stock situation?', 'Inventory', '/mon/analytics/inventory'],
    ['কোথায় খরচ?', 'Expenses', '/mon/analytics/expenses'],
  ]

  it('renders all 7 onboarding sections', async () => {
    const { getByText, getByTestId } = await wrap(<AnalyticsHelp />)

    await expect.element(getByTestId('analytics-help')).toBeInTheDocument()
    for (const h of HEADINGS) {
      await expect.element(getByText(h, { exact: true })).toBeInTheDocument()
    }
  })

  it('numbers the starter as exactly 5 steps', async () => {
    const { container } = await wrap(<AnalyticsHelp />)
    const starter = container.querySelector('section[aria-label="কোথা থেকে শুরু করবেন"]')
    expect(starter?.querySelectorAll('li')).toHaveLength(5)
    expect(starter?.textContent ?? '').toContain('Date Range')
  })

  it('links every question row to its canonical route', async () => {
    const { container } = await wrap(<AnalyticsHelp />)
    const anchors = [...container.querySelectorAll('[data-testid="analytics-help"] a')]
    const byHref = new Map(anchors.map((a) => [a.getAttribute('href'), a.textContent ?? '']))
    for (const [question, page, href] of HELP_LINKS) {
      expect(byHref.has(href), `missing help link ${href}`).toBe(true)
      expect(byHref.get(href) ?? '').toContain(page)
      expect(container.textContent ?? '').toContain(question)
    }
  })

  it('keeps English terminology and avoids forced translations', async () => {
    const { container } = await wrap(<AnalyticsHelp />)
    const text = container.textContent ?? ''
    for (const term of ['Net Sales', 'Drill Down', 'ROAS', 'Business Overview', 'Date Range']) {
      expect(text).toContain(term)
    }
    expect(text).not.toContain('নিট বিক্রয়')
  })

  it('names real badges and links instead of overpromising clicks', async () => {
    const { container } = await wrap(<AnalyticsHelp />)
    const text = container.textContent ?? ''
    expect(text).not.toContain('যেকোনো সংখ্যায় ক্লিক')
    expect(text).not.toContain('দেখতে পাবেন')
    for (const honest of ['Low margin badge', 'uncosted badge', 'coverage badge', 'Drill Down link']) {
      expect(text).toContain(honest)
    }
  })

  it('states the delivered-only rule and keeps the Dashboard closer un-numbered', async () => {
    const { container, getByText } = await wrap(<AnalyticsHelp />)

    await expect.element(getByText(/ডেলিভারির আগের অর্ডার এখনো বিক্রি নয়/)).toBeInTheDocument()
    await expect.element(getByText(/লাভ-ক্ষতির সব প্রশ্ন Analytics-এ/)).toBeInTheDocument()
    const closer = container.querySelector('section[aria-label="Dashboard বনাম Analytics"]')
    expect(closer?.querySelector('ol')).toBeNull()
    expect(closer?.querySelectorAll('p')).toHaveLength(2)
  })

  it('keeps every section body under 600 characters', async () => {
    const { container } = await wrap(<AnalyticsHelp />)
    const sections = [...container.querySelectorAll('section[aria-label]')]
    expect(sections).toHaveLength(7)
    for (const s of sections) {
      expect((s.textContent ?? '').length).toBeLessThanOrEqual(600)
    }
  })
})
