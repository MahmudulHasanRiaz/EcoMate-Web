'use client'

import { ChevronsUpDown } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuTrigger,
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
    { name: 'Operational', key: 'operational' as PanelType, plan: 'Orders & Catalog', route: '/op', visible: true },
    { name: 'Admin', key: 'monitoring' as PanelType, plan: 'Settings & Overview', route: '/mon', visible: role === 'superadmin' || role === 'admin' },
    { name: 'Packing Workspace', key: 'packing' as any, plan: 'Order Packing Workspace', route: '/op/packing', visible: role === 'superadmin' || role === 'admin' },
  ].filter(t => t.visible)

  const active = teams.find(t => t.key === activePanel) || teams[0]

  return (
    <SidebarMenu>
      <SidebarMenuItem className="px-1.5 pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="w-full transition-all duration-150 border border-border/40 hover:bg-muted/40 rounded-lg shadow-xs data-[state=open]:bg-sidebar-accent"
            >
              <div className="flex aspect-square size-7 items-center justify-center rounded-md border border-border/70 bg-muted/40 text-foreground font-semibold">
                <ChevronsUpDown className="size-3.5 text-muted-foreground/80" />
              </div>
              <div className="grid flex-1 text-start text-xs leading-tight ml-1.5">
                <span className="truncate font-bold text-foreground text-[12px]">{active.name} Panel</span>
                <span className="truncate text-[10px] text-muted-foreground/80 font-medium">{active.plan}</span>
              </div>
              <ChevronsUpDown className="ms-auto size-3.5 text-muted-foreground/70" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-[220px] rounded-lg shadow-md border-border/80"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground px-2.5 py-1.5">
              Switch Panel
            </DropdownMenuLabel>
            <div className="p-1 space-y-0.5">
              {teams.map((team) => {
                const isActive = team.key === activePanel
                return (
                  <DropdownMenuItem
                    key={team.key}
                    onClick={() => {
                      setActivePanel(team.key)
                      navigate({ to: team.route })
                    }}
                    className={`flex items-center gap-2.5 p-2 rounded-md cursor-pointer ${
                      isActive ? 'bg-secondary text-secondary-foreground font-semibold' : 'focus:bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <div className="flex size-6 items-center justify-center rounded bg-muted/40 border border-border/80">
                      <ChevronsUpDown className="size-3 text-muted-foreground" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold leading-tight">{team.name} Panel</span>
                      <span className="text-[9px] text-muted-foreground leading-tight">{team.plan}</span>
                    </div>
                  </DropdownMenuItem>
                )
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
