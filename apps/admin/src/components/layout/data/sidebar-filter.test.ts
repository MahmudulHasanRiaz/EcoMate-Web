import { describe, expect, it } from 'vitest'
import { filterNavItems, EVERYTHING_FEATURE } from './sidebar-filter'
import { sidebarData } from './sidebar-data'
import type { NavItem } from '../types'

/*
 * Route-module imports (mon/users/presets, op/employees/presets) are tested in
 * a separate vitest Node-mode config (vitest.route.config.ts) because the
 * @/ alias required by those modules is not available in vitest-browser.
 * This file tests filterNavItems and sidebarData integration only.
 */

describe('filterNavItems', () => {
  /* ── Root-level items (flat links) ── */

  const flatItems: NavItem[] = [
    { title: 'All Users', url: '/mon/users', feature: 'admin_users' },
    { title: 'Access Presets', url: '/mon/users/presets', feature: 'admin_access_presets' },
  ]

  it('shows both when both features are present', () => {
    const result = filterNavItems(flatItems, ['admin_users', 'admin_access_presets'])
    expect(result).toHaveLength(2)
  })

  it('shows only the item whose feature matches', () => {
    const result = filterNavItems(flatItems, ['admin_users'])
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('All Users')
  })

  it('shows only the other item when its feature matches', () => {
    const result = filterNavItems(flatItems, ['admin_access_presets'])
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Access Presets')
  })

  it('shows nothing when no features match', () => {
    const result = filterNavItems(flatItems, [])
    expect(result).toHaveLength(0)
  })

  it('shows everything with wildcard feature', () => {
    const result = filterNavItems(flatItems, [EVERYTHING_FEATURE])
    expect(result).toHaveLength(2)
  })

  /* ── Collapsible parent items ── */

  const collapsibleItems: NavItem[] = [
    {
      title: 'User Management',
      items: [
        { title: 'All Users', url: '/mon/users', feature: 'admin_users' },
        { title: 'Access Presets', url: '/mon/users/presets', feature: 'admin_access_presets' },
      ],
    },
  ]

  it('collapsible parent without feature shows when child matches', () => {
    const result = filterNavItems(collapsibleItems, ['admin_users'])
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('User Management')
    expect('items' in result[0] && result[0].items).toHaveLength(1)
    expect(('items' in result[0] && result[0].items?.[0])?.title).toBe('All Users')
  })

  it('collapsible parent without feature hides when no children match', () => {
    const result = filterNavItems(collapsibleItems, [])
    expect(result).toHaveLength(0)
  })

  it('collapsible parent without feature shows all children when all features present', () => {
    const result = filterNavItems(collapsibleItems, [EVERYTHING_FEATURE])
    expect(result).toHaveLength(1)
    expect('items' in result[0] && result[0].items).toHaveLength(2)
  })

  /* ── Feature-gated parent ── */

  const gatedCollapsible: NavItem[] = [
    {
      title: 'Employees',
      feature: 'admin_employees',
      items: [
        { title: 'All Employees', url: '/op/employees' },
        { title: 'Designations', url: '/op/employees/designations' },
      ],
    },
  ]

  it('collapsible parent with feature hides completely when feature missing', () => {
    const result = filterNavItems(gatedCollapsible, [])
    expect(result).toHaveLength(0)
  })

  it('collapsible parent with feature shows when feature present', () => {
    const result = filterNavItems(gatedCollapsible, ['admin_employees'])
    expect(result).toHaveLength(1)
  })

  /* ── Item without feature always shows ── */

  it('item without feature always passes through', () => {
    const result = filterNavItems([{ title: 'Dashboard', url: '/op/overview' }], [])
    expect(result).toHaveLength(1)
  })

  /* ── Permission-gated items (HR panel) ── */

  const permissionItems: NavItem[] = [
    { title: 'HR Dashboard', url: '/hr/overview', feature: 'admin_hr', permissions: ['view_hr'] },
  ]

  it('permission-gated item hidden when permission missing', () => {
    const result = filterNavItems(permissionItems, ['admin_hr'], [])
    expect(result).toHaveLength(0)
  })

  it('permission-gated item hidden when feature missing even with permission', () => {
    const result = filterNavItems(permissionItems, [], ['view_hr'])
    expect(result).toHaveLength(0)
  })

  it('permission-gated item shows when feature + any permission present', () => {
    const result = filterNavItems(permissionItems, ['admin_hr'], ['some_other', 'view_hr'])
    expect(result).toHaveLength(1)
  })

  it('permission-gated collapsible parent hides entirely without permission', () => {
    const items: NavItem[] = [
      {
        title: 'Employees',
        feature: 'admin_employees',
        permissions: ['view_hr'],
        items: [{ title: 'All Employees', url: '/hr/employees' }],
      },
    ]
    const result = filterNavItems(items, ['admin_employees'], ['manage_employees'])
    expect(result).toHaveLength(0)
  })

  it('items without permissions still show without permission list', () => {
    const result = filterNavItems(flatItems, ['admin_users'])
    expect(result).toHaveLength(1)
  })

  /* ── Production sidebarData integration ── */

  const hrGroup = sidebarData.navGroups.find(g => g.panel === 'hr')!
  const userMgmt = hrGroup.items.find(
    (i): i is NavItem & { items: NavItem[] } => 'items' in i && i.items !== undefined && i.title === 'User Management',
  )!

  it('sidebarData HR > User Management shows All Users when only admin_users + view_hr', () => {
    const result = filterNavItems([userMgmt], ['admin_users'], ['view_hr'])
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('User Management')
    const items = 'items' in result[0] ? result[0].items : []
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('All Users')
    expect(items[0].url).toBe('/hr/users')
  })

  it('sidebarData HR > User Management shows Access Presets when only admin_access_presets', () => {
    const result = filterNavItems([userMgmt], ['admin_access_presets'], ['view_hr'])
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('User Management')
    const items = 'items' in result[0] ? result[0].items : []
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Access Presets')
    expect(items[0].url).toBe('/hr/presets')
  })

  it('sidebarData HR > User Management shows both when both features present', () => {
    const result = filterNavItems([userMgmt], ['admin_users', 'admin_access_presets'], ['view_hr'])
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('User Management')
    const items = 'items' in result[0] ? result[0].items : []
    expect(items).toHaveLength(2)
  })

  it('sidebarData HR > User Management hides when neither feature present', () => {
    const result = filterNavItems([userMgmt], [], ['view_hr'])
    expect(result).toHaveLength(0)
  })

  it('sidebarData HR > User Management hides without view_hr permission', () => {
    const result = filterNavItems([userMgmt], [EVERYTHING_FEATURE], [])
    expect(result).toHaveLength(0)
  })

  it('sidebarData HR > User Management shows all children with wildcard', () => {
    const result = filterNavItems([userMgmt], [EVERYTHING_FEATURE], ['view_hr'])
    expect(result).toHaveLength(1)
    const items = 'items' in result[0] ? result[0].items : []
    expect(items).toHaveLength(2)
  })

  it('sidebarData hr top-level items filter without crashing on production data', () => {
    const result = filterNavItems(hrGroup.items, ['admin_users'], ['view_hr'])
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('sidebarData monitoring top-level items filter without crashing on production data', () => {
    const monitoringGroup = sidebarData.navGroups.find(g => g.panel === 'monitoring')!
    const result = filterNavItems(monitoringGroup.items, ['admin_users'])
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  /* ── Monitoring Dashboard & Analytics consolidation ── */

  const opGroup = sidebarData.navGroups.find(g => g.panel === 'operational')!
  const monitoringGroup = sidebarData.navGroups.find(g => g.panel === 'monitoring')!

  it('operational panel has no Business Analytics group', () => {
    expect(opGroup.items.some(i => i.title === 'Business Analytics')).toBe(false)
  })

  it('no sidebar url points at legacy /op/analytics', () => {
    const urls: string[] = []
    for (const g of sidebarData.navGroups) {
      for (const item of g.items) {
        if ('url' in item && item.url) urls.push(item.url as string)
        if ('items' in item && item.items) {
          for (const sub of item.items) {
            if (sub.url) urls.push(sub.url as string)
          }
        }
      }
    }
    expect(urls.filter(u => u.startsWith('/op/analytics'))).toEqual([])
  })

  it('monitoring panel is the Dashboard & Analytics group', () => {
    expect(monitoringGroup.title).toBe('Dashboard & Analytics')
  })

  it('monitoring panel keeps Dashboard entry first', () => {
    expect(monitoringGroup.items[0].title).toBe('Dashboard')
    expect('url' in monitoringGroup.items[0] && monitoringGroup.items[0].url).toBe('/mon/overview')
  })

  it('monitoring Analytics entry is canonical-named with 8 children', () => {
    const analytics = monitoringGroup.items.find(i => i.title === 'Analytics')!
    expect(analytics).toBeDefined()
    expect('items' in analytics && analytics.items).toHaveLength(8)
    const urls = ('items' in analytics && analytics.items ? analytics.items : []).map(s => s.url)
    expect(urls).toEqual([
      '/mon/analytics',
      '/mon/analytics/sales',
      '/mon/analytics/products',
      '/mon/analytics/customers',
      '/mon/analytics/marketing',
      '/mon/analytics/inventory',
      '/mon/analytics/expenses',
      '/mon/analytics/help',
    ])
  })

  it('monitoring Analytics gate preserves admin_analytics with no child permissions', () => {
    const analytics = monitoringGroup.items.find(i => i.title === 'Analytics')!
    expect(analytics.feature).toBe('admin_analytics')
    expect(analytics.permissions).toBeUndefined()
    const children = 'items' in analytics && analytics.items ? analytics.items : []
    for (const child of children) {
      expect(child.permissions).toBeUndefined()
    }
  })

  it('monitoring Analytics shows all children when admin_analytics present', () => {
    const analytics = monitoringGroup.items.find(i => i.title === 'Analytics')!
    const result = filterNavItems([analytics], ['admin_analytics'])
    expect(result).toHaveLength(1)
    expect('items' in result[0] && result[0].items).toHaveLength(8)
  })

  it('monitoring Analytics hides completely without admin_analytics', () => {
    const analytics = monitoringGroup.items.find(i => i.title === 'Analytics')!
    expect(filterNavItems([analytics], [])).toHaveLength(0)
  })
})
