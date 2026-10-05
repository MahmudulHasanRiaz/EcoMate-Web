'use client'

import { ChevronsUpDown, Check, Package, ShieldCheck, Users, Boxes, type LucideIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { usePanel, type PanelType } from '@/context/panel-provider'
import { usePermission } from '@/lib/permissions'
import { useAuthStore } from '@/stores/auth-store'
import { useLicenseStore } from '@/stores/license-store'

type Team = {
  name: string
  key: PanelType | 'packing'
  plan: string
  route: string
  visible: boolean
  logo: LucideIcon
}

export function TeamSwitcher() {
  const { isMobile } = useSidebar()
  const { activePanel, setActivePanel } = usePanel()
  const role = useAuthStore(s => s.auth.user?.role || 'admin')
  const canViewHr = usePermission('view_hr')
  const hasFeature = useLicenseStore(s => s.hasFeature)
  const navigate = useNavigate()

  // Both halves are required: the licence gates the HR panel, the permission
  // gates the data inside it.
  const canAccessHr =
    role === 'superadmin' || role === 'admin' || (hasFeature('admin_hr') && canViewHr)

  const allTeams: Team[] = [
    { name: 'Operational', key: 'operational', plan: 'Orders & Catalog', route: '/op', visible: true, logo: Package },
    { name: 'Admin', key: 'monitoring', plan: 'Settings & Overview', route: '/mon', visible: role === 'superadmin' || role === 'admin', logo: ShieldCheck },
    { name: 'HR Management', key: 'hr', plan: 'People & Payroll', route: '/hr/overview', visible: canAccessHr, logo: Users },
    { name: 'Packing Workspace', key: 'packing', plan: 'Order Packing Workspace', route: '/op/packing', visible: role === 'superadmin' || role === 'admin', logo: Boxes },
  ]
  const teams = allTeams.filter(t => t.visible)

  const active = teams.find(t => t.key === activePanel) || teams[0]

  return (
    <SidebarMenu>
      <SidebarMenuItem className="px-1.5 pt-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="default"
              className="w-full h-9 gap-2 rounded-md border border-border/60 bg-background/80 hover:bg-surface-raised px-2 py-1 text-left transition-all duration-150 data-[state=open]:bg-surface-raised shadow-2xs"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-ink">
                <active.logo className="size-3.5" />
              </span>
              <span className="grid min-w-0 flex-1 text-start leading-tight">
                <span className="truncate text-[12px] font-semibold text-ink">{active.name}</span>
                <span className="truncate text-[10px] font-medium text-ink-muted">{active.plan}</span>
              </span>
              <ChevronsUpDown className="size-3 shrink-0 text-ink-muted/70" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-[220px] rounded-lg border-border/60 p-1 shadow-pop"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              Switch Panel
            </DropdownMenuLabel>
            <div className="space-y-0.5">
              {teams.map((team) => {
                const isActive = team.key === activePanel
                return (
                  <DropdownMenuItem
                    key={team.key}
                    onClick={() => {
                      setActivePanel(team.key as PanelType)
                      navigate({ to: team.route })
                    }}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                      isActive ? 'bg-primary-soft text-primary-ink' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
                    }`}
                  >
                    <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${isActive ? 'bg-primary-soft text-primary-ink' : 'bg-sunken text-ink-muted'}`}>
                      <team.logo className="size-3.5" />
                    </span>
                    <span className="grid min-w-0 flex-1 leading-tight">
                      <span className="truncate font-semibold">{team.name}</span>
                      <span className="truncate text-[10px] opacity-80">{team.plan}</span>
                    </span>
                    {isActive && <Check className="size-3.5 shrink-0" />}
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
