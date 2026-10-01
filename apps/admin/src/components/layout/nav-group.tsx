import { type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Badge } from '../ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  type NavCollapsible,
  type NavItem,
  type NavLink,
  type NavGroup as NavGroupProps,
  type HueName,
} from './types'

/** Group hue → 20px icon-chip tint (soft bg + ink + border). */
const HUE_CHIP: Record<HueName, { soft: string; ink: string; border: string }> = {
  info: { soft: 'var(--info-soft)', ink: 'var(--info-ink)', border: 'var(--info-border)' },
  success: { soft: 'var(--success-soft)', ink: 'var(--success-ink)', border: 'var(--success-border)' },
  warning: { soft: 'var(--warning-soft)', ink: 'var(--warning-ink)', border: 'var(--warning-border)' },
  danger: { soft: 'var(--danger-soft)', ink: 'var(--danger-ink)', border: 'var(--danger-border)' },
  violet: { soft: 'var(--accent-violet-soft)', ink: 'var(--accent-violet-ink)', border: 'var(--accent-violet-border)' },
  cyan: { soft: 'var(--accent-cyan-soft)', ink: 'var(--accent-cyan-ink)', border: 'var(--accent-cyan-border)' },
  pink: { soft: 'var(--accent-pink-soft)', ink: 'var(--accent-pink-ink)', border: 'var(--accent-pink-border)' },
  neutral: { soft: 'var(--sunken)', ink: 'var(--ink-muted)', border: 'var(--border)' },
}

function chipStyle(hue: HueName): CSSProperties {
  const c = HUE_CHIP[hue]
  return { '--chip-soft': c.soft, '--chip-ink': c.ink, '--chip-border': c.border } as CSSProperties
}

export function NavGroup({ title, items }: NavGroupProps) {
  const { state, isMobile } = useSidebar()
  const href = useLocation({ select: (location) => location.href })

  const renderItem = (item: NavItem, hue: HueName, key: string) => {
    if (!item.items) return <SidebarMenuLink key={key} item={item} hue={hue} href={href} />
    if (state === 'collapsed' && !isMobile) {
      return <SidebarMenuCollapsedDropdown key={key} item={item} hue={hue} href={href} />
    }
    return <SidebarMenuCollapsible key={key} item={item} hue={hue} href={href} />
  }

  // Group the flat items by their presentational section, rendering a
  // non-clickable label between groups. Order is preserved; nothing is dropped.
  const renderBlocks = () => {
    const blocks: ReactNode[] = []
    let currentSection: string | null = null
    let currentItems: NavItem[] = []
    let n = 0

    const flush = () => {
      if (currentItems.length > 0) {
        blocks.push(
          <SidebarMenu key={`m-${n++}`} className="space-y-0.5 px-1.5">
            {currentItems.map((item) => renderItem(item, item.section?.hue ?? 'neutral', `${item.title}`))}
          </SidebarMenu>
        )
        currentItems = []
      }
    }

    items.forEach((item) => {
      const s = item.section?.label ?? null
      if (s !== currentSection) {
        flush()
        currentSection = s
        if (s) {
          blocks.push(
            <SidebarGroupLabel
              key={`l-${n++}`}
              className={cn(
                'px-2.5 text-[10px] font-semibold tracking-wider text-ink-muted/80 uppercase select-none transition-colors',
                n > 1 ? 'pt-3 pb-1' : 'pt-1 pb-1'
              )}
            >
              {s}
            </SidebarGroupLabel>
          )
        }
      }
      currentItems.push(item)
    })
    flush()
    return blocks
  }

  return (
    <SidebarGroup className="py-1">
      {title && (
        <SidebarGroupLabel className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-ink-muted/80 uppercase select-none">
          {title}
        </SidebarGroupLabel>
      )}
      {renderBlocks()}
    </SidebarGroup>
  )
}

function NavBadge({ children }: { children: ReactNode }) {
  return (
    <Badge className="rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none bg-primary/15 text-primary dark:text-primary-ink border border-primary/20 shadow-2xs">
      {children}
    </Badge>
  )
}

function SidebarMenuLink({ item, hue, href }: { item: NavLink; hue: HueName; href: string }) {
  const { setOpenMobile } = useSidebar()
  const isExternal =
    !item.url!.startsWith('/op/') &&
    !item.url!.startsWith('/mon/') &&
    !item.url!.startsWith('/hr/')
  const isActive = isExternal ? false : checkIsActive(href, item)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={item.title}
        className="nav-item h-[30px] px-2 text-[12.5px] font-medium rounded-md gap-2"
      >
        {isExternal ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpenMobile(false)}
            className="flex w-full items-center gap-2"
          >
            {item.icon && (
              <span className="nav-chip" style={chipStyle(hue)}>
                <item.icon className="size-3.5" />
              </span>
            )}
            <span className="truncate flex-1 font-medium leading-none" title={item.title}>
              {item.title}
            </span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
          </a>
        ) : (
          <Link
            to={item.url}
            onClick={() => setOpenMobile(false)}
            className="flex w-full items-center gap-2"
          >
            {item.icon && (
              <span className="nav-chip" style={chipStyle(hue)}>
                <item.icon className="size-3.5" />
              </span>
            )}
            <span className="truncate flex-1 font-medium leading-none" title={item.title}>
              {item.title}
            </span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
          </Link>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarMenuCollapsible({
  item,
  hue,
  href,
}: {
  item: NavCollapsible
  hue: HueName
  href: string
}) {
  const { setOpenMobile } = useSidebar()
  const isActive = checkIsActive(href, item)

  return (
    <Collapsible
      asChild
      defaultOpen={checkIsActive(href, item, true)}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={isActive}
            className="nav-item h-[30px] px-2 text-[12.5px] font-medium rounded-md gap-2"
          >
            {item.icon && (
              <span className="nav-chip" style={chipStyle(hue)}>
                <item.icon className="size-3.5" />
              </span>
            )}
            <span className="truncate flex-1 font-medium leading-none" title={item.title}>
              {item.title}
            </span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className="ms-auto size-3 text-ink-muted/60 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="CollapsibleContent">
          <SidebarMenuSub className="border-l border-border/60 ml-3.5 pl-2 space-y-0.5 my-0.5">
            {item.items.map((subItem) => {
              const isSubActive = checkIsActive(href, subItem)
              return (
                <SidebarMenuSubItem key={subItem.title}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={isSubActive}
                    className="nav-sub-item h-[26px] px-2 text-[12px] font-medium rounded-md gap-2"
                  >
                    <Link to={subItem.url} onClick={() => setOpenMobile(false)} className="flex w-full items-center gap-2">
                      {subItem.icon && (
                        <span className="nav-chip" style={chipStyle(hue)}>
                          <subItem.icon className="size-3" />
                        </span>
                      )}
                      <span className="truncate flex-1 font-medium leading-none" title={subItem.title}>
                        {subItem.title}
                      </span>
                      {subItem.badge && <NavBadge>{subItem.badge}</NavBadge>}
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function SidebarMenuCollapsedDropdown({
  item,
  hue,
  href,
}: {
  item: NavCollapsible
  hue: HueName
  href: string
}) {
  const isActive = checkIsActive(href, item)

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={isActive}
            className="nav-item h-[30px] px-2 text-[12.5px] font-medium rounded-md gap-2"
          >
            {item.icon && (
              <span className="nav-chip" style={chipStyle(hue)}>
                <item.icon className="size-3.5" />
              </span>
            )}
            <span className="truncate flex-1 font-medium leading-none" title={item.title}>
              {item.title}
            </span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className="ms-auto size-3 text-ink-muted/60 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={6}
          className="rounded-xl border border-border/80 shadow-xl bg-popover/95 backdrop-blur-md min-w-[210px] p-1 animate-in fade-in zoom-in-95 duration-100"
        >
          <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {item.title} {item.badge ? `(${item.badge})` : ''}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-border/60 my-1" />
          <div className="space-y-0.5">
            {item.items.map((sub) => {
              const isSubActive = checkIsActive(href, sub)
              return (
                <DropdownMenuItem key={`${sub.title}-${sub.url}`} asChild className="focus:bg-surface-raised rounded-md">
                  <Link
                    to={sub.url}
                    className={cn(
                      'flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors',
                      isSubActive ? 'bg-primary-soft text-primary-ink font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised'
                    )}
                  >
                    {sub.icon && (
                      <span className="nav-chip" style={chipStyle(hue)}>
                        <sub.icon className="size-3" />
                      </span>
                    )}
                    <span className="max-w-52 truncate flex-1">{sub.title}</span>
                    {sub.badge && (
                      <span className="ms-auto text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">
                        {sub.badge}
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
              )
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function checkIsActive(href: string, item: NavItem, mainNav = false) {
  return (
    href === item.url || // /endpoint?search=param
    href.split('?')[0] === item.url || // endpoint
    !!item?.items?.filter((i) => i.url === href).length || // if child nav is active
    (mainNav &&
      href.split('/')[1] !== '' &&
      href.split('/')[1] === item?.url?.split('/')[1])
  )
}
