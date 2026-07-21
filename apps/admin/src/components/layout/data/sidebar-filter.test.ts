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

  /* ── Production sidebarData integration ── */

  const monitoringGroup = sidebarData.navGroups.find(g => g.panel === 'monitoring')!
  const userMgmt = monitoringGroup.items.find(
    (i): i is NavItem & { items: NavItem[] } => 'items' in i && i.items !== undefined && i.title === 'User Management',
  )!

  it('sidebarData Monitoring > User Management shows All Users when only admin_users', () => {
    const result = filterNavItems([userMgmt], ['admin_users'])
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('User Management')
    const items = 'items' in result[0] ? result[0].items : []
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('All Users')
    expect(items[0].url).toBe('/mon/users')
  })

  it('sidebarData Monitoring > User Management shows Access Presets when only admin_access_presets', () => {
    const result = filterNavItems([userMgmt], ['admin_access_presets'])
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('User Management')
    const items = 'items' in result[0] ? result[0].items : []
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Access Presets')
    expect(items[0].url).toBe('/mon/users/presets')
  })

  it('sidebarData Monitoring > User Management shows both when both features present', () => {
    const result = filterNavItems([userMgmt], ['admin_users', 'admin_access_presets'])
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('User Management')
    const items = 'items' in result[0] ? result[0].items : []
    expect(items).toHaveLength(2)
  })

  it('sidebarData Monitoring > User Management hides when neither feature present', () => {
    const result = filterNavItems([userMgmt], [])
    expect(result).toHaveLength(0)
  })

  it('sidebarData Monitoring > User Management shows all children with wildcard', () => {
    const result = filterNavItems([userMgmt], [EVERYTHING_FEATURE])
    expect(result).toHaveLength(1)
    const items = 'items' in result[0] ? result[0].items : []
    expect(items).toHaveLength(2)
  })

  it('sidebarData monitoring top-level items filter without crashing on production data', () => {
    const result = filterNavItems(monitoringGroup.items, ['admin_users'])
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})
