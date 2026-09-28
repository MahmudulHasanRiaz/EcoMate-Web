import { type LinkProps } from '@tanstack/react-router'

type User = {
  name: string
  email: string
  avatar: string
}

type Team = {
  name: string
  logo: React.ElementType
  plan: string
}

/** Group hue — drives the 20px icon chip tint. From the fixed palette. */
export type HueName = 'info' | 'success' | 'warning' | 'danger' | 'violet' | 'cyan' | 'pink' | 'neutral'

type BaseNavItem = {
  title: string
  badge?: string
  icon?: React.ElementType
  feature?: string
  permissions?: string[]
  panel?: 'operational' | 'monitoring' | 'hr'
  /** Presentational section grouping (label + icon-chip hue). */
  section?: { label: string; hue: HueName }
}

type NavLink = BaseNavItem & {
  url: LinkProps['to'] | (string & {})
  items?: never
}

type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: LinkProps['to'] | (string & {}) })[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

type NavGroup = {
  title: string
  panel?: string
  icon?: React.ElementType
  items: NavItem[]
}

type SidebarData = {
  user: User
  teams: Team[]
  navGroups: NavGroup[]
}

export type { SidebarData, NavGroup, NavItem, NavCollapsible, NavLink }
