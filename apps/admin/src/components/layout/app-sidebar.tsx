import { useLayout } from '@/context/layout-provider'
import { usePanel } from '@/context/panel-provider'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { TeamSwitcher } from './team-switcher'
import { useLicenseStore } from '@/stores/license-store'
import type { NavCollapsible, NavItem, NavLink } from './types'

const EVERYTHING_FEATURE = '*'

function filterNavItems(items: NavItem[], features: string[]): NavItem[] {
  const hasFeature = (key: string) => features.includes(EVERYTHING_FEATURE) || features.includes(key)
  return items.reduce<NavItem[]>((acc, item) => {
    if ('items' in item && item.items) {
      const subItems = filterNavItems(item.items, features)
      const parentHasFeature = !item.feature || hasFeature(item.feature)
      if (!parentHasFeature) return acc
      if (subItems.length === 0) return acc
      acc.push({ ...item, items: subItems } as NavCollapsible)
    } else {
      if (item.feature && !hasFeature(item.feature)) return acc
      acc.push(item as NavLink)
    }
    return acc
  }, [])
}

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const { activePanel } = usePanel()
  const features = useLicenseStore((s) => s.features)

  const mainGroups = sidebarData.navGroups
    .filter((g) => g.title !== 'Secondary' && (!g.panel || g.panel === activePanel))
    .map((g) => ({
      ...g,
      items: filterNavItems(g.items, features),
    }))
    .filter((g) => g.items.length > 0)

  const secondaryGroup = sidebarData.navGroups.find((g) => g.title === 'Secondary')
  const footerItems = secondaryGroup?.items.filter(
    (item) => !item.panel || item.panel === activePanel
  )
  const filteredFooter = footerItems ? filterNavItems(footerItems, features) : []

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {mainGroups.map((props, idx) => (
          <NavGroup key={props.title || props.panel || idx} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        {filteredFooter.length > 0 && (
          <NavGroup title='' items={filteredFooter} />
        )}
        <NavUser user={sidebarData.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
