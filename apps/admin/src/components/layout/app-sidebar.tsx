import { useLayout } from '@/context/layout-provider'
import { usePanel } from '@/context/panel-provider'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { TeamSwitcher } from './team-switcher'
import { useLicenseStore } from '@/stores/license-store'
import { filterNavItems } from './data/sidebar-filter'

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
