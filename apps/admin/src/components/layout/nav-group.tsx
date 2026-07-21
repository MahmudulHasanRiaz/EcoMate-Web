import { type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
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
} from './types'

export function NavGroup({ title, items }: NavGroupProps) {
  const { state, isMobile } = useSidebar()
  const href = useLocation({ select: (location) => location.href })
  return (
    <SidebarGroup className="py-2.5">
      {title && (
        <SidebarGroupLabel className="text-[10px] font-extrabold tracking-wider text-muted-foreground/85 uppercase px-3.5 py-1 h-auto select-none">
          {title}
        </SidebarGroupLabel>
      )}
      <SidebarMenu className="space-y-0.5 px-1.5">
        {items.map((item) => {
          const key = `${item.title}-${item.url}`

          if (!item.items)
            return <SidebarMenuLink key={key} item={item} href={href} />

          if (state === 'collapsed' && !isMobile)
            return (
              <SidebarMenuCollapsedDropdown key={key} item={item} href={href} />
            )

          return <SidebarMenuCollapsible key={key} item={item} href={href} />
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function NavBadge({ children }: { children: ReactNode }) {
  return (
    <Badge className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold leading-none bg-primary text-primary-foreground border-none">
      {children}
    </Badge>
  )
}

function SidebarMenuLink({ item, href }: { item: NavLink; href: string }) {
  const { setOpenMobile } = useSidebar()
  const isExternal = !item.url!.startsWith('/op/') && !item.url!.startsWith('/mon/')
  const isActive = isExternal ? false : checkIsActive(href, item)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={item.title}
        className={`w-full h-8.5 px-3.5 transition-all duration-150 rounded-md font-medium text-[13px] border-l-2 ${
          isActive
            ? 'bg-secondary text-secondary-foreground font-semibold border-primary shadow-xs'
            : 'text-muted-foreground/90 border-transparent hover:text-foreground hover:bg-muted/40'
        }`}
      >
        {isExternal ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpenMobile(false)} className="flex items-center gap-2.5">
            {item.icon && <item.icon className="h-4 w-4 shrink-0 text-muted-foreground/85" />}
            <span className="truncate flex-1">{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
          </a>
        ) : (
          <Link to={item.url} onClick={() => setOpenMobile(false)} className="flex items-center gap-2.5">
            {item.icon && <item.icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/85'}`} />}
            <span className="truncate flex-1">{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
          </Link>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarMenuCollapsible({
  item,
  href,
  }: {
  item: NavCollapsible
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
            className={`w-full h-8.5 px-3.5 transition-all duration-150 rounded-md font-medium text-[13px] border-l-2 ${
              isActive
                ? 'text-foreground font-semibold border-primary bg-muted/20'
                : 'text-muted-foreground/90 border-transparent hover:text-foreground hover:bg-muted/40'
            }`}
          >
            {item.icon && <item.icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/85'}`} />}
            <span className="truncate flex-1">{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className="ms-auto h-3.5 w-3.5 text-muted-foreground/70 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 rtl:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="CollapsibleContent">
          <SidebarMenuSub className="border-l border-border/50 ml-5.5 pl-2.5 space-y-0.5 mt-0.5">
            {item.items.map((subItem) => {
              const isSubActive = checkIsActive(href, subItem)
              return (
                <SidebarMenuSubItem key={subItem.title}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={isSubActive}
                    className={`w-full h-8 px-3 transition-all duration-150 rounded-md font-medium text-[12px] ${
                      isSubActive
                        ? 'bg-secondary text-secondary-foreground font-semibold shadow-xs'
                        : 'text-muted-foreground/80 hover:text-foreground hover:bg-muted/30'
                    }`}
                  >
                    <Link to={subItem.url} onClick={() => setOpenMobile(false)} className="flex items-center gap-2">
                      {subItem.icon && <subItem.icon className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate flex-1">{subItem.title}</span>
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
  href,
}: {
  item: NavCollapsible
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
            className={`w-full h-8.5 transition-all duration-150 rounded-md border-l-2 ${
              isActive
                ? 'bg-secondary text-secondary-foreground font-semibold border-primary shadow-xs'
                : 'text-muted-foreground/90 border-transparent hover:text-foreground hover:bg-muted/40'
            }`}
          >
            {item.icon && <item.icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/85'}`} />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className="ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={4} className="rounded-lg shadow-md border-border/80 min-w-[200px]">
          <DropdownMenuLabel className="text-xs font-bold text-muted-foreground px-2.5 py-1.5">
            {item.title} {item.badge ? `(${item.badge})` : ''}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-border/60" />
          <div className="p-1 space-y-0.5">
            {item.items.map((sub) => {
              const isSubActive = checkIsActive(href, sub)
              return (
                <DropdownMenuItem key={`${sub.title}-${sub.url}`} asChild className="focus:bg-muted rounded-md">
                  <Link
                    to={sub.url}
                    className={`flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      isSubActive ? 'bg-secondary text-secondary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {sub.icon && <sub.icon className="h-3.5 w-3.5 shrink-0" />}
                    <span className="max-w-52 text-wrap flex-1">{sub.title}</span>
                    {sub.badge && (
                      <span className="ms-auto text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">{sub.badge}</span>
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
