import { useLayout } from '@/context/layout-provider'
import { usePanel } from '@/context/panel-provider'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { TeamSwitcher } from './team-switcher'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const { activePanel } = usePanel()

  const mainGroups = sidebarData.navGroups.filter(
    (g) => g.title !== 'Secondary' && (!g.panel || g.panel === activePanel)
  )

  const secondaryGroup = sidebarData.navGroups.find((g) => g.title === 'Secondary')
  const footerItems = secondaryGroup?.items.filter(
    (item: any) => !item.panel || item.panel === activePanel
  )

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {mainGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        {footerItems && (
          <NavGroup title='' items={footerItems} />
        )}
        <NavUser user={sidebarData.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
