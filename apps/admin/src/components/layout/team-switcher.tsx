import { ChevronsUpDown } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { usePanel, type PanelType } from '@/context/panel-provider'
import { useAuthStore } from '@/stores/auth-store'

export function TeamSwitcher() {
  const { isMobile } = useSidebar()
  const { activePanel, setActivePanel } = usePanel()
  const role = useAuthStore(s => s.auth.user?.role || 'admin')
  const navigate = useNavigate()

  const teams = [
    { name: 'Operational', key: 'operational' as PanelType, plan: 'Orders & Products', route: '/op', visible: true },
    { name: 'Admin', key: 'monitoring' as PanelType, plan: 'Settings & Reports', route: '/mon', visible: role === 'superadmin' || role === 'admin' },
  ].filter(t => t.visible)

  const active = teams.find(t => t.key === activePanel) || teams[0]

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size='lg' className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'>
              <div className='flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
                <ChevronsUpDown className='size-4' />
              </div>
              <div className='grid flex-1 text-start text-sm leading-tight'>
                <span className='truncate font-semibold'>{active.name}</span>
                <span className='truncate text-xs'>{active.plan}</span>
              </div>
              <ChevronsUpDown className='ms-auto' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg' align='start' side={isMobile ? 'bottom' : 'right'} sideOffset={4}>
            <DropdownMenuLabel className='text-xs text-muted-foreground'>Select Panel</DropdownMenuLabel>
            {teams.map((team, index) => (
              <DropdownMenuItem key={team.key} onClick={() => { setActivePanel(team.key); navigate({ to: team.route }) }} className='gap-2 p-2'>
                <div className='flex size-6 items-center justify-center rounded-sm border'><ChevronsUpDown className='size-4 shrink-0' /></div>
                {team.name}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
